import type { SpindleAPI } from "lumiverse-spindle-types";
import type { TrackerConfig } from "../shared/trackerConfig";
import type { TemplatePreset } from "../shared/templatePresets";
import type { BackendToFrontendMessage } from "../shared/wireMessages";
import { stringify as stringifyYaml } from "yaml";
import { parseGeneratedTrackerPayload, parseTrackerPayload } from "./trackerPayload";
import { buildSecondaryPrompt } from "./secondaryPrompt";
import { collectSecondaryHistory } from "./secondaryHistory";
import { resolveSecondaryConnection } from "./secondaryConnection";
import { stripStructuralHTML } from "./secondaryPromptText";
import { buildTrackerFenceRegex, buildTrackerTagRegex, sanitizeTagName } from "../shared/trackerSyntax";
import {
  applyFastLaneAnswers,
  buildFastLanePlan,
  buildVerifyPlan,
  evaluateTypeSafe,
  interpretGate,
  interpretVerifyAnswers,
  type TypeSafeAnswers,
  type TypeSafeCorsTransport,
} from "./typesafe";

export function createSecondaryGeneration(deps: {
  spindle: SpindleAPI;
  readConfig: () => TrackerConfig;
  readActiveUserId: () => string | null;
  hasPermission: (name: string) => boolean;
  trackEvent: (
    eventName: string,
    payload?: Record<string, unknown>,
    options?: { level?: "debug" | "info" | "warn" | "error"; chatId?: string },
  ) => Promise<void>;
  getActivePreset: () => TemplatePreset;
  buildExampleTrackerBlock: (format: "json" | "yaml", identifier: string) => string;
  formatTrackerPayload: (data: Record<string, unknown>, format: "json" | "yaml", identifier: string) => string;
  rehydrateChatTrackerHistory: (chatId: string | null) => Promise<void>;
  extractTrackerPayloadFromMessage: (content: string) => string | null;
  getRecentChatTrackers: (chatId: string, limit: number, excludeMessageId: string) => Array<{ payload: string }>;
  recordChatTracker: (chatId: string | null, messageId: string | null, payload: string) => void;
  pushMacroValues: () => void;
  typeSafeCorsTransport: TypeSafeCorsTransport;
}) {
  const {
    spindle,
    hasPermission,
    trackEvent,
    getActivePreset,
    buildExampleTrackerBlock,
    formatTrackerPayload,
    rehydrateChatTrackerHistory,
    extractTrackerPayloadFromMessage,
    getRecentChatTrackers,
    recordChatTracker,
    pushMacroValues,
    typeSafeCorsTransport,
  } = deps;
type SecondaryJob = {
  chatId: string;
  messageId: string;
  userId: string | null;
  config: TrackerConfig;
  preset: TemplatePreset;
};
// ── Secondary LLM Generation ─────────────────────────────────────────
//
// We run at most one secondary generation at a time per backend, serialized
// through a Promise chain. Earlier versions used a `secondaryGenerationInProgress`
// flag that caused `GENERATION_ENDED` to *drop* subsequent requests if a
// previous secondary was still in flight — the visible symptom was "the last
// message sometimes doesn't get a tracker" when the user replied faster than
// the sidecar could finish.
let secondaryGenerationChain: Promise<void> = Promise.resolve();
const queuedSecondaryJobs = new Set<string>();

function enqueueSecondaryGeneration(chatId: string, messageId: string): Promise<void> {
  const key = `${chatId}::${messageId}`;
  // Drop duplicate requests for the same (chat, message) while one is queued.
  // The in-flight job's pre-flight `extractTrackerPayloadFromMessage` check
  // would no-op anyway once the first run finishes, so this is just hygiene.
  if (queuedSecondaryJobs.has(key)) return secondaryGenerationChain;
  queuedSecondaryJobs.add(key);
  const job: SecondaryJob = {
    chatId,
    messageId,
    userId: deps.readActiveUserId(),
    config: { ...deps.readConfig() },
    preset: getActivePreset(),
  };
  secondaryGenerationChain = secondaryGenerationChain
    .catch(() => undefined)
    .then(() => generateTrackerWithSecondaryLLM(job))
    .catch((err) => {
      spindle.log.error(`Queued secondary LLM generation failed: ${err instanceof Error ? err.message : String(err)}`);
    })
    .finally(() => {
      queuedSecondaryJobs.delete(key);
    });
  return secondaryGenerationChain;
}

function describeMissingModelGuidance(): string {
  return "The selected connection has no usable default model. Choose a model in SimTracker settings → Secondary LLM, or select a connection with a configured model.";
}

function describeRejectedModelGuidance(model: string): string {
  return `The provider rejected the configured model id \`${model}\`. Open SimTracker settings → Secondary LLM and confirm the override matches a model this connection can serve, or clear the override to fall back to the connection's default.`;
}

/**
 * Append a tracker block built from `parsed` to the target message and run
 * the shared post-append bookkeeping: canonical content update, macro
 * refresh, and side-channel history record (so the next run sees this
 * tracker as "most recent" even if the frontend's removeFromMessage strips
 * it from storage). Used by both the TypeSafe fast lane and the full
 * secondary-LLM path.
 */
async function commitTrackerAppend(
  chatId: string,
  targetMessage: { id: string; content: string },
  parsed: Record<string, unknown>,
  via: string,
  config: TrackerConfig,
  userId: string | null,
): Promise<void> {
  const trackerBlock = formatTrackerPayload(parsed, config.trackerFormat, config.codeBlockIdentifier);
  const updatedContent = `${targetMessage.content.trimEnd()}\n\n${trackerBlock}`;
  await spindle.chat.updateMessage(chatId, targetMessage.id, { content: updatedContent });

  const lastSimStats = config.trackerFormat === "yaml"
    ? stringifyYaml(parsed)
    : JSON.stringify(parsed, null, 2);
  recordChatTracker(chatId, targetMessage.id, lastSimStats);
  pushMacroValues();

  spindle.log.info(`Tracker append complete via ${via}`);
  spindle.sendToFrontend({
    type: "secondary_generation_complete",
    chatId,
    messageId: targetMessage.id,
    content: updatedContent,
    via,
  } satisfies BackendToFrontendMessage, userId || undefined);
}

async function generateTrackerWithSecondaryLLM(job: SecondaryJob): Promise<void> {
  const { chatId, messageId: targetMessageId, config, preset, userId } = job;
  if (!config.useSecondaryLLM) return;
  if (!hasPermission("generation")) {
    spindle.log.warn("Secondary LLM generation requires 'generation' permission");
    return;
  }
  if (!hasPermission("chat_mutation")) {
    spindle.log.warn("Secondary LLM generation requires 'chat_mutation' permission");
    return;
  }
  // Model id for the provider call, validated after the TypeSafe fast lane
  // (which never reaches the provider). Declared here so the catch block
  // below can reference it in rejection guidance.
  let trimmedModel = (config.secondaryLLMModel || "").trim();

  spindle.sendToFrontend(
    { type: "secondary_generation_started", chatId, messageId: targetMessageId } satisfies BackendToFrontendMessage,
    userId || undefined,
  );

  try {
    // Ensure the side-channel history is primed for this chat before we
    // rely on it. Safe to call repeatedly — rehydration is idempotent.
    await rehydrateChatTrackerHistory(chatId);

    const messages = await spindle.chat.getMessages(chatId);
    if (!messages.length) return;

    const targetMessage = messages.find((m) => m.id === targetMessageId);
    if (!targetMessage || targetMessage.role !== "assistant") return;
    if (extractTrackerPayloadFromMessage(targetMessage.content)) return;

    const systemPrompt = preset.sysPrompt || "";
    const formatExample = buildExampleTrackerBlock(config.trackerFormat, config.codeBlockIdentifier);
    const processedPrompt = systemPrompt.replace(/\{\{sim_format\}\}/g, formatExample);

    const tagName = sanitizeTagName(config.trackerTagName);
    const identifier = config.codeBlockIdentifier;
    const messageCount = config.secondaryLLMMessageCount;

    const recentMessages = messages
      .filter((m) => m.role !== "system")
      .slice(-messageCount);

    // ── Historical tracker progression ────────────────────────────────
    //
    // Pull the most recent historical trackers so the secondary LLM can
    // see how the state has been evolving rather than only the single
    // latest value. The side-channel history is the primary source
    // (survives `removeFromMessage`) with a full-chat scan as a fallback
    // in case events were missed or the extension was reloaded.
    //
    // Honour the user's "Retain N trackers" setting exactly: 0 means no
    // prior context, anything ≥1 caps at 10 to keep the prompt bounded.
    const historicalTrackers = collectSecondaryHistory({
      retainTrackerCount: config.retainTrackerCount,
      targetMessageId,
      messages,
      getRecentPayloads: (limit, excludeMessageId) => getRecentChatTrackers(chatId, limit, excludeMessageId).map((entry) => entry.payload),
      extractTrackerPayloadFromMessage,
    });

    // ── TypeSafe fast lane: gate + quick append ────────────────────────
    //
    // One speculative fan-out Jev call (gate + per-field questions, all
    // evaluated in parallel) decides whether this message needs no tracker
    // ("none"), a quick numeric patch of the previous payload ("minor"),
    // or the full secondary LLM below. Every failure mode — no API key,
    // missing cors_proxy permission, timeout, API error, low confidence —
    // falls through to the full path, which is why the provider-specific
    // pre-flight checks now live below this block.
    if (config.typeSafeEnabled && config.typeSafeQuickAppend && config.typeSafeApiKey.trim() && hasPermission("cors_proxy")) {
      const previousPayload = historicalTrackers.length > 0
        ? parseTrackerPayload(historicalTrackers[historicalTrackers.length - 1])
        : null;
      if (previousPayload) {
        // Same cleaning the full path applies to context messages: strip
        // tracker blocks, optionally structural HTML.
        let fastLaneMessage = targetMessage.content
          .replace(buildTrackerTagRegex(tagName, "ig"), "")
          .replace(buildTrackerFenceRegex(identifier, "gi"), "");
        if (config.secondaryLLMStripHTML) fastLaneMessage = stripStructuralHTML(fastLaneMessage);
        const fields = (Array.isArray(preset.customFields) ? preset.customFields : [])
          .map((field) => ({
            key: typeof field?.key === "string" ? field.key : "",
            description: typeof field?.description === "string" ? field.description : "",
          }))
          .filter((field) => field.key);
        const plan = buildFastLanePlan({ message: fastLaneMessage.trim(), previousPayload, fields });
        if (plan) {
          let answers: TypeSafeAnswers | null = null;
          try {
            answers = await evaluateTypeSafe(
              typeSafeCorsTransport,
              { apiKey: config.typeSafeApiKey.trim(), model: config.typeSafeModel },
              plan.state,
              plan.questions,
            );
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            spindle.log.warn(`TypeSafe fast lane unavailable, falling back to full secondary LLM: ${detail}`);
            await trackEvent("sst.typesafe.error", { stage: "fast-lane", error: detail }, { level: "warn", chatId });
          }
          if (answers) {
            const gate = interpretGate(answers, config.typeSafeConfidenceFloor);
            if (gate === "skip") {
              spindle.log.info("TypeSafe gate: no tracker changes warranted for this message");
              await trackEvent("sst.typesafe.gate_skip", { messageId: targetMessageId }, { chatId });
              spindle.sendToFrontend(
                { type: "secondary_generation_skipped", chatId, messageId: targetMessageId } satisfies BackendToFrontendMessage,
                userId || undefined,
              );
              return;
            }
            if (gate === "fast") {
              const result = applyFastLaneAnswers(previousPayload, plan.directives, answers, config.typeSafeConfidenceFloor);
              if (result.changed.length > 0) {
                await commitTrackerAppend(chatId, targetMessage, result.payload, "typesafe-fast-lane", config, userId);
                await trackEvent("sst.typesafe.fast_append", { changed: result.changed }, { chatId });
                return;
              }
              // "Minor" turn but nothing crossed the confidence floor to
              // patch — let the full path capture whatever we couldn't.
              await trackEvent("sst.typesafe.fast_append_fallback", { reason: "no-confident-changes" }, { chatId });
            }
          }
        }
      }
    }

    // Provider-specific pre-flight (moved below the TypeSafe fast lane,
    // which never reaches the provider and therefore needs neither).
    if (!hasPermission("generation_parameters")) {
      const guidance = "Secondary LLM generation requires the 'generation_parameters' permission so the configured model id reaches the provider. Grant it in SimTracker's permission prompt and try again.";
      spindle.log.warn(guidance);
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: guidance, chatId, messageId: targetMessageId } satisfies BackendToFrontendMessage,
        userId || undefined,
      );
      return;
    }
    const connections = await spindle.connections.list(userId || undefined);
    const route = resolveSecondaryConnection(connections, config.secondaryLLMConnectionId, trimmedModel);
    trimmedModel = route.model;
    if (!route.ok) {
      const guidance = route.reason === "provider"
        ? "Secondary LLM connection has no usable provider. Select a configured connection in SimTracker settings and try again."
        : describeMissingModelGuidance();
      spindle.log.warn(guidance);
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: guidance, chatId, messageId: targetMessageId } satisfies BackendToFrontendMessage,
        userId || undefined,
      );
      return;
    }
    const { connection, provider } = route;

    const { cleanedMessages, conversationText } = buildSecondaryPrompt({
      processedPrompt,
      historicalTrackers,
      recentMessages,
      tagName,
      identifier,
      stripHTML: config.secondaryLLMStripHTML,
      trackerFormat: config.trackerFormat,
    });

    const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "user", content: conversationText },
    ];

    // Model has been validated above; always emit it so the connection's
    // placeholder default never reaches the provider.
    const parameters: Record<string, unknown> = {
      model: trimmedModel,
      temperature: config.secondaryLLMTemperature,
    };

    spindle.log.info(
      `Secondary LLM request → chat=${chatId} target=${targetMessageId} connection=${connection.id} model=${trimmedModel} temperature=${config.secondaryLLMTemperature} history=${historicalTrackers.length} contextMessages=${cleanedMessages.length}`,
    );
    // The current `GenerationRequestDTO` only declares `parameters` for
    // overrides, but empirically Spindle strips `model` from `parameters`
    // before forwarding. The docstring examples in spindle-api.ts show
    // `model` at the top level of the request, so we send it both places
    // and let whichever path the runtime honours win.
    const generationRequest = {
      type: "raw" as const,
      messages: llmMessages,
      parameters,
      connection_id: connection.id,
      userId: userId || undefined,
      provider,
      model: trimmedModel,
    };
    const result = await spindle.generate.raw(generationRequest as Parameters<typeof spindle.generate.raw>[0]);

    const resultObj = result as Record<string, unknown>;
    const generatedText = typeof resultObj.content === "string" ? resultObj.content : "";
    if (!generatedText) {
      spindle.log.warn("Secondary LLM returned empty response");
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: "Empty response from LLM", chatId, messageId: targetMessageId } satisfies BackendToFrontendMessage,
        userId || undefined,
      );
      return;
    }

    let parsed = parseGeneratedTrackerPayload(generatedText);
    if (!parsed) {
      spindle.log.warn("Secondary LLM response was invalid; attempting one syntax repair");
      const repairResult = await spindle.generate.raw({
        ...generationRequest,
        messages: [
          {
            role: "system",
            content: `Repair the supplied tracker as ${config.trackerFormat.toUpperCase()} syntax. Preserve all existing fields and values. Do not add explanations, code fences, or XML tags. Return only the complete corrected document.`,
          },
          { role: "user", content: generatedText },
        ],
      } as Parameters<typeof spindle.generate.raw>[0]);
      const repairResultObj = repairResult as Record<string, unknown>;
      const repairedText = typeof repairResultObj.content === "string" ? repairResultObj.content : "";
      parsed = parseGeneratedTrackerPayload(repairedText);
    }
    if (!parsed) {
      spindle.log.warn("Secondary LLM response and repair could not be parsed as valid tracker data");
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: "LLM response was not valid tracker data after one repair attempt", chatId, messageId: targetMessageId } satisfies BackendToFrontendMessage,
        userId || undefined,
      );
      return;
    }

    // ── TypeSafe verification (post-generation gate) ──────────────────
    //
    // One fan-out of per-field nouls checks the generated payload against
    // the narrative and the previous tracker (SDE-cascade style). Any
    // P(wrong) over threshold rejects the append — a wrong tracker poisons
    // every subsequent generation via history and macros. Verification
    // fails open: if TypeSafe is unreachable, append anyway (the full
    // path's pre-existing behavior).
    if (config.typeSafeEnabled && config.typeSafeVerify && config.typeSafeApiKey.trim() && hasPermission("cors_proxy") && historicalTrackers.length > 0) {
      const previousPayload = parseTrackerPayload(historicalTrackers[historicalTrackers.length - 1]);
      const narrative = cleanedMessages.map((msg) => `${msg.role === "user" ? "User" : "Character"}: ${msg.content}`).join("\n\n");
      const verifyPlan = previousPayload
        ? buildVerifyPlan({ narrative, previousPayload, generatedPayload: parsed })
        : null;
      if (verifyPlan) {
        try {
          const verdict = interpretVerifyAnswers(await evaluateTypeSafe(
            typeSafeCorsTransport,
            { apiKey: config.typeSafeApiKey.trim(), model: config.typeSafeModel },
            verifyPlan.state,
            verifyPlan.questions,
          ));
          if (!verdict.ok) {
            const message = `TypeSafe verification rejected the generated tracker: ${verdict.reasons.join("; ")}`;
            spindle.log.warn(message);
            spindle.sendToFrontend(
              { type: "secondary_generation_error", message, chatId, messageId: targetMessageId } satisfies BackendToFrontendMessage,
              userId || undefined,
            );
            await trackEvent("sst.typesafe.verify_reject", { reasons: verdict.reasons }, { level: "warn", chatId });
            return;
          }
          await trackEvent("sst.typesafe.verify_pass", {}, { chatId });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          spindle.log.warn(`TypeSafe verification unavailable, appending anyway: ${detail}`);
          await trackEvent("sst.typesafe.error", { stage: "verify", error: detail }, { level: "warn", chatId });
        }
      }
    }

    await commitTrackerAppend(chatId, targetMessage, parsed, "secondary-llm", config, userId);
    await trackEvent("sst.secondary_generation.complete", {
      connectionId: config.secondaryLLMConnectionId,
      model: config.secondaryLLMModel,
    }, { chatId });
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    // Pre-flight already bailed on empty/placeholder models, so any
    // upstream model-field rejection here means the user's configured id
    // didn't satisfy the provider. Point at *that* fix instead of telling
    // them to fill in a field they already filled in.
    const looksLikeModelError = /\bmodel\b/i.test(rawMessage)
      && /(missing|invalid|empty|required|not.*found)/i.test(rawMessage);
    const message = looksLikeModelError
      ? `${rawMessage}\n\n${describeRejectedModelGuidance(trimmedModel)}`
      : rawMessage;
    spindle.log.error(`Secondary LLM generation failed: ${rawMessage}`);
    spindle.sendToFrontend(
      { type: "secondary_generation_error", message, chatId, messageId: targetMessageId } satisfies BackendToFrontendMessage,
      userId || undefined,
    );
    await trackEvent("sst.secondary_generation.failed", { error: rawMessage }, { level: "error" });
  }
}
  return { enqueueSecondaryGeneration };
}
