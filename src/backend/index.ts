import { getTemplatePresetById, getTemplatePresets, mergeTemplatePresets, type TemplatePreset } from "../shared/templatePresets";
import type { LlmMessageDTO } from "lumiverse-spindle-types";
import { stringify as stringifyYaml } from "yaml";
import { formatTrackerForPrompt, parseGeneratedTrackerPayload, parseTrackerPayload } from "./trackerPayload";
import { buildTemplateExampleData as buildTemplateExampleDataForPreset, formatTrackerPayload as formatTrackerPayloadWithTag } from "./trackerCommandText";
import { buildFirstMessageHint } from "../shared/fertilityCycleHint";
import { DEFAULT_CONFIG, type TrackerConfig } from "../shared/trackerConfig";
import { mergeTrackerConfig } from "./backendConfig";
import { buildTrackerFenceRegex, buildTrackerTagRegex, sanitizeIdentifier, sanitizeTagName } from "../shared/trackerSyntax";
import { createTrackerMessageCodec } from "./trackerMessageCodec";
import { createTrackerPromptRetention } from "./trackerPromptRetention";
import { createTrackerHistory } from "./trackerHistory";
import { createLegacyTrackerNormalizer } from "./trackerLegacyMigration";
import { buildConceptionDirective, latestNarrativeBeat, planForcedConception, rewriteTrackerInMessages, type ConceptionMutation } from "./conceptionFlow";
import { discoverSeededPresets } from "./seededPresets";
import { createImportService } from "./importService";
import { buildSecondaryPrompt } from "./secondaryPrompt";
import { collectSecondaryHistory } from "./secondaryHistory";
import { resolveSecondaryConnection } from "./secondaryConnection";
import { createCommandEngine } from "./commandEngine";
import { createSettingsStore } from "./settingsStore";
import { sanitizeSysPromptForWireFormat, stripStructuralHTML } from "./secondaryPromptText";
import { readMessageContext } from "./backendMessageContext";
import { CONCEPTION_CONFIG, coinFlip, extractCurrentDate, getCharactersFromPayload, isAlreadyConceivedOrPregnant, isFemaleOrFuta, isInFertileWindow } from "./conceptionRules";
import {
  applyFastLaneAnswers,
  buildConceptionQuestions,
  buildFastLanePlan,
  buildVerifyPlan,
  evaluateTypeSafe,
  interpretConceptionAnswers,
  interpretGate,
  interpretVerifyAnswers,
  type ConceptionCandidate,
  VERIFY_NARRATIVE_CHAR_CAP,
  type TypeSafeAnswers,
  type TypeSafeCorsTransport,
} from "./typesafe";

/**
 * DI-boundary adapter: routes every TypeSafe call through Lumiverse's CORS
 * proxy (requires the `cors_proxy` permission). Shared by the fast lane, the
 * verifier, and the conception gate.
 */
const typeSafeCorsTransport: TypeSafeCorsTransport = (url, options) => spindle.cors(url, options);

declare const spindle: import("lumiverse-spindle-types").SpindleAPI & {
  frontendCapabilities?: {
    declare(capability: "message_tag_interceptor"): () => void;
  };
};

// Tell the host that chat content is not display-stable until this
// extension's frontend has attached its configured tag interceptor. The host
// snapshots this declaration before low-priority frontend hydration, avoiding
// a first paint of raw tracker JSON on chat load.
spindle.frontendCapabilities?.declare("message_tag_interceptor");

let config: TrackerConfig = { ...DEFAULT_CONFIG };
let lastSimStats = "{}";
let activeUserId: string | null = null;
let loadedConfigUserId: string | null = null;
let firstMessageFertilityHint = "";

/**
 * Last chat id the extension saw activity on. The interceptor signature
 * (`context: unknown`) doesn't contractually expose the chat id, so we
 * mirror it from `GENERATION_STARTED` (which does carry it) and from
 * any other event that surfaces a chat id. Used as a fallback when the
 * interceptor context can't be parsed.
 */
let activeChatId: string | null = null;

/**
 * Tracks which (chatId, characterName) pairs have already received a
 * conception notice so we don't spam the same directive repeatedly.
 * Cleared when the character is explicitly marked `conceived: true` or
 * `preg: true` in a subsequent tracker payload.
 */
const conceptionNotified = new Set<string>();

const runtime = {
  grantedPermissions: new Set<string>(),
  seededPresets: [] as TemplatePreset[],
  seededPresetsLoaded: false,
};

function getAllPresets(): TemplatePreset[] {
  return mergeTemplatePresets(getTemplatePresets(), runtime.seededPresets, config.userPresets);
}

function getActivePreset(): TemplatePreset {
  return getAllPresets().find((preset) => preset.id === config.templateId)
    || getTemplatePresetById(config.templateId)
    || getTemplatePresetById(DEFAULT_CONFIG.templateId);
}

const trackerMessageCodec = createTrackerMessageCodec(() => config);
const { extractTrackerPayloadFromMessage, normalizeLegacyHiddenDivTrackers } = trackerMessageCodec;
const normalizeLegacyTrackersInChat = createLegacyTrackerNormalizer({
  getMessages: (chatId) => spindle.chat.getMessages(chatId),
  updateMessage: (chatId, messageId, change) => spindle.chat.updateMessage(chatId, messageId, change),
  hasChatMutationPermission: () => hasPermission("chat_mutation"),
  normalizeLegacyHiddenDivTrackers,
  logInfo: (message) => spindle.log.info(message),
});
const { recordChatTracker, forgetChatTracker, getChatTrackerHistory, rehydrateChatTrackerHistory, getRecentChatTrackers } = createTrackerHistory({
  normalizeLegacyTrackersInChat,
  extractTrackerPayloadFromMessage,
  readRetainCount: () => config.retainTrackerCount,
});
const { handleSlashCommand } = createCommandEngine({
  readConfig: () => config,
  readLastSimStats: () => lastSimStats,
  writeLastSimStats: (value) => { lastSimStats = value; },
  getActivePreset,
  extractTrackerPayloadFromMessage,
  hasChatMutationPermission: () => hasPermission("chat_mutation"),
  getMessages: (chatId) => spindle.chat.getMessages(chatId),
  updateMessage: (chatId, messageId, change) => spindle.chat.updateMessage(chatId, messageId, change),
  pushMacroValues,
  trackEvent,
});
const handleImportPresetFile = createImportService({
  hasEphemeralPermission: () => hasPermission("ephemeral_storage"),
  requestBlock: (bytes, options) => spindle.ephemeral.requestBlock(bytes, options),
  writeEphemeral: (path, text, options) => spindle.ephemeral.write(path, text, options),
  releaseBlock: (reservationId) => spindle.ephemeral.releaseBlock(reservationId),
  sendToFrontend: (message, userId) => spindle.sendToFrontend(message, userId),
  readConfig: () => config,
  writeConfig: (value) => { config = value; },
  saveConfig: (userId) => saveConfig(userId),
  pushMacroValues,
  sendConfigState: (userId) => sendConfigState(userId),
  trackEvent,
});
const settingsStore = createSettingsStore({
  getJson: (path, options) => spindle.userStorage.getJson<Partial<TrackerConfig>>(path, options),
  setJson: (path, value, options) => spindle.userStorage.setJson(path, value, options),
  enclaveGet: (key, userId) => spindle.enclave.get(key, userId),
  enclavePut: (key, value, userId) => spindle.enclave.put(key, value, userId),
  enclaveDelete: (key, userId) => spindle.enclave.delete(key, userId),
  logError: (message) => spindle.log.error(message),
  logWarn: (message) => spindle.log.warn(message),
});

function hasPermission(name: string): boolean {
  return runtime.grantedPermissions.has(name);
}

async function trackEvent(
  eventName: string,
  payload?: Record<string, unknown>,
  options?: { level?: "debug" | "info" | "warn" | "error"; chatId?: string },
): Promise<void> {
  if (!hasPermission("event_tracking")) return;
  try {
    await spindle.events.track(eventName, payload, options);
  } catch {
    // Telemetry should never break runtime behavior.
  }
}

// ── Per-Chat Tracker History (side-channel) ──────────────────────────
//
// Maintains a backend-owned record of every tracker payload the extension
// has seen in each chat, keyed by message id. Populated from:
//   1. MESSAGE_TAG_INTERCEPTED — fires as soon as the frontend tag
//      interceptor observes a tracker tag, BEFORE `removeFromMessage`
//      has a chance to clear it from the canonical message content.
//   2. MESSAGE_SENT / MESSAGE_EDITED — fallback for messages whose
//      tracker blocks survived as code fences or tags in the content.
//   3. rehydrateChatTrackerHistory — initial scan of the current chat
//      on demand, so history is populated even for chats the extension
//      wasn't active in when the message was originally generated.

/**
 * Inspect the most recent tracker payload for a chat and decide whether
 * any female character should receive a conception nudge.  Returns an
 * array of character names that triggered this turn.
 *
 * Rules:
 *   - Character must be female/futa, in a fertile window, not already
 *     conceived/pregnant.
 *   - womb_fullness_pct must be > threshold (default 85).
 *   - If fullness >= autoAt (default 100) the nudge is automatic.
 *   - If threshold < fullness < autoAt, the gray zone: TypeSafe weighs the
 *     tracked fertility factors against the scene narrative (falls back to
 *     the historical coin flip when TypeSafe is unavailable).
 *   - Once a (chatId, name) pair has been notified, it won't be notified
 *     again until the character is explicitly marked conceived/pregnant
 *     in a tracker payload (which clears the flag).
 */
async function checkConceptionTriggers(
  chatId: string | null,
  payload: Record<string, unknown>,
  narrative: string,
): Promise<string[]> {
  if (!chatId) return [];
  const characters = getCharactersFromPayload(payload);
  const triggered: string[] = [];
  const grayZone: ConceptionCandidate[] = [];

  for (const stats of characters) {
    if (!isFemaleOrFuta(stats)) continue;
    if (isAlreadyConceivedOrPregnant(stats)) {
      // She's officially flagged; drop the lock and skip
      const key = `${chatId}::${stats.name}`;
      if (conceptionNotified.has(key)) conceptionNotified.delete(key);
      continue;
    }
    if (!isInFertileWindow(stats)) continue;

    const fullness = Number(stats.womb_fullness_pct);
    if (!Number.isFinite(fullness) || fullness <= CONCEPTION_CONFIG.threshold) continue;

    const name = String(stats.name || "Unknown");
    const key = `${chatId}::${name}`;
    if (conceptionNotified.has(key)) {
      // Gate already passed; the LLM dropped `conceived` from its emission.
      // Re-add to the trigger list so the mutation path re-asserts it.
      triggered.push(name);
      continue;
    }

    if (fullness >= CONCEPTION_CONFIG.autoAt) {
      conceptionNotified.add(key);
      triggered.push(name);
    } else {
      grayZone.push({ name, stats });
    }
  }

  if (grayZone.length === 0) return triggered;
  for (const name of await resolveGrayZoneConception(chatId, grayZone, narrative)) {
    conceptionNotified.add(`${chatId}::${name}`);
    triggered.push(name);
  }
  return triggered;
}

/**
 * Decide gray-zone conceptions (threshold < fullness < autoAt).  TypeSafe
 * runs one fan-out call with a fertilization noul per at-risk character,
 * weighing cycle stage/day, receptivity, breeding count, and cervix state
 * against the scene narrative.  Any failure mode — disabled toggle, missing
 * key/permission, timeout, API error — degrades to the historical coin flip.
 */
async function resolveGrayZoneConception(
  chatId: string | null,
  candidates: ConceptionCandidate[],
  narrative: string,
): Promise<string[]> {
  if (config.typeSafeEnabled && config.typeSafeConception && config.typeSafeApiKey.trim() && hasPermission("cors_proxy")) {
    try {
      const plan = buildConceptionQuestions(candidates);
      const answers = await evaluateTypeSafe(
        typeSafeCorsTransport,
        { apiKey: config.typeSafeApiKey.trim(), model: config.typeSafeModel },
        { scene: narrative.slice(0, VERIFY_NARRATIVE_CHAR_CAP), ...plan.state },
        plan.questions,
      );
      const fired = interpretConceptionAnswers(answers, candidates);
      await trackEvent(
        "sst.typesafe.conception_decided",
        { fired, considered: candidates.map((c) => c.name) },
        { chatId: chatId ?? undefined },
      );
      return fired;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      spindle.log.warn(`TypeSafe conception gate unavailable, falling back to coin flip: ${detail}`);
      await trackEvent("sst.typesafe.error", { stage: "conception", error: detail }, { level: "warn", chatId: chatId ?? undefined });
    }
  }
  return candidates.filter(() => coinFlip()).map((c) => c.name);
}

function commitForcedConception(chatId: string, plan: ConceptionMutation): void {
  const history = getChatTrackerHistory(chatId);
  const idx = history.findIndex((entry) => entry.messageId === plan.messageId);
  if (idx === -1) return;
  history[idx] = { ...history[idx], payload: plan.newPayload };
}

function buildTemplateExampleData(): Record<string, unknown> {
  return buildTemplateExampleDataForPreset(getActivePreset());
}

function buildExampleTrackerBlock(format: "json" | "yaml", identifier: string): string {
  const data = buildTemplateExampleData();
  return formatTrackerPayload(data, format, identifier);
}

function formatTrackerPayload(data: Record<string, unknown>, format: "json" | "yaml", identifier: string): string {
  return formatTrackerPayloadWithTag(data, format, identifier, config.trackerTagName);
}

async function loadConfig(userId: string): Promise<void> {
  config = await settingsStore.loadConfig(userId, (normalized) => { config = normalized; });
  loadedConfigUserId = userId;
  pushMacroValues();
}

async function ensureConfigForUser(userId?: string | null): Promise<void> {
  if (!userId) return;
  if (activeUserId === userId && loadedConfigUserId === userId) return;
  activeUserId = userId;
  await loadConfig(userId);
}

async function loadSeededTemplatePresets(): Promise<void> {
  if (runtime.seededPresetsLoaded) return;
  runtime.seededPresets = await discoverSeededPresets({
    exists: (path) => spindle.storage.exists(path),
    list: (path) => spindle.storage.list(path),
    stat: (path) => spindle.storage.stat(path),
    getJson: (path) => spindle.storage.getJson<Record<string, unknown>>(path, { fallback: {} }),
  });
  runtime.seededPresetsLoaded = true;
}

async function saveConfig(userId: string, configToSave: TrackerConfig = config): Promise<void> {
  await settingsStore.saveConfig(userId, configToSave);
}

async function syncTypeSafeKeyToEnclave(userId: string, nextKey: string, previousKey: string): Promise<void> {
  await settingsStore.syncTypeSafeKeyToEnclave(userId, nextKey, previousKey);
}


spindle.on("MESSAGE_SENT", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    const ctx = readMessageContext(payload);
    const message = ctx.content;
    if (typeof message !== "string") return;

    if (ctx.chatId) {
      activeChatId = ctx.chatId;
      void rehydrateChatTrackerHistory(ctx.chatId);
    }

    const commandResult = await handleSlashCommand(message, ctx);
    if (commandResult) {
      spindle.sendToFrontend(commandResult, activeUserId || undefined);
      await trackEvent(
        "sst.command.result",
        {
          command: commandResult.payload.command,
          ok: commandResult.payload.ok,
          mode: commandResult.payload.mode || "fallback",
        },
        ctx.chatId ? { chatId: ctx.chatId } : undefined,
      );
    }

    const sim = extractTrackerPayloadFromMessage(message);
    if (sim) {
      lastSimStats = sim;
      recordChatTracker(ctx.chatId, ctx.messageId, sim);
      pushMacroValues();
      await trackEvent("sst.tracker.detected", { identifier: config.codeBlockIdentifier }, ctx.chatId ? { chatId: ctx.chatId } : undefined);
    }
  })();
});

spindle.on("MESSAGE_EDITED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    const ctx = readMessageContext(payload);
    if (ctx.chatId) activeChatId = ctx.chatId;
    if (typeof ctx.content !== "string") return;
    const sim = extractTrackerPayloadFromMessage(ctx.content);
    if (sim) {
      lastSimStats = sim;
      recordChatTracker(ctx.chatId, ctx.messageId, sim);
      pushMacroValues();
      await trackEvent("sst.tracker.detected", { identifier: config.codeBlockIdentifier, source: "message_edited" }, ctx.chatId ? { chatId: ctx.chatId } : undefined);
      return;
    }
    // Edit removed the tracker (e.g. swipe to a variant without one) — drop
    // the side-channel entry so stale data doesn't leak into generation.
    forgetChatTracker(ctx.chatId, ctx.messageId);
  })();
});

spindle.on("MESSAGE_SWIPED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;

    const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
    if (chatId) activeChatId = chatId;
    const message = obj.message && typeof obj.message === "object"
      ? (obj.message as Record<string, unknown>)
      : null;
    if (!chatId || !message) return;

    const messageId = typeof message.id === "string" ? message.id : null;
    if (!messageId) return;

    const action = typeof obj.action === "string" ? obj.action : "";
    const activeSwipeId = typeof message.swipe_id === "number" ? message.swipe_id : 0;

    // Determine which swipe's content is authoritative for this event.
    //   - added     : the new swipe, which is `swipes[swipe_id]` (usually the
    //                 one just created). `content` mirrors it.
    //   - updated   : the edited swipe. If the edited slot is the active one,
    //                 `content` reflects it; otherwise we still prefer the
    //                 active slot because that's what downstream generation
    //                 will actually see.
    //   - deleted   : `content` is the post-deletion active swipe.
    //   - navigated : `content` is the destination swipe.
    // In every case `message.content` (= `swipes[swipe_id]`) is the right
    // source, so we don't need to special-case per action.
    const activeContent = typeof message.content === "string"
      ? message.content
      : Array.isArray(message.swipes) && typeof message.swipes[activeSwipeId] === "string"
        ? (message.swipes[activeSwipeId] as string)
        : "";

    const payloadText = extractTrackerPayloadFromMessage(activeContent);
    if (payloadText) {
      // Re-sync the side-channel to the currently active swipe's tracker.
      // This is essential so that when the user cycles between swipe
      // variants, subsequent generations (main or secondary) reference the
      // tracker data that actually matches the on-screen narrative rather
      // than whichever variant was last recorded.
      recordChatTracker(chatId, messageId, payloadText);
      lastSimStats = payloadText;
      pushMacroValues();
    } else {
      // The active swipe has no tracker tag. Drop the side-channel entry
      // for this message so it isn't used as "prior state" for the next
      // generation. This also correctly handles the `added` case where a
      // brand-new swipe slot starts empty pending generation — by clearing
      // M(n)'s stale entry we guarantee the new generation references the
      // previous message's tracker, not the previous swipe's.
      forgetChatTracker(chatId, messageId);
    }

    await trackEvent(
      "sst.swipe.synced",
      { action, swipeId: typeof obj.swipeId === "number" ? obj.swipeId : null },
      { chatId },
    );
  })();
});

spindle.on("MESSAGE_TAG_INTERCEPTED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    const tagName = typeof obj.tagName === "string" ? sanitizeTagName(obj.tagName) : "";
    if (tagName !== sanitizeTagName(config.trackerTagName)) return;

    const attrs = obj.attrs && typeof obj.attrs === "object" ? (obj.attrs as Record<string, unknown>) : {};
    const tagType = sanitizeIdentifier(typeof attrs.type === "string" ? attrs.type : "");
    if (tagType && tagType !== sanitizeIdentifier(config.codeBlockIdentifier)) return;

    const content = typeof obj.content === "string" ? obj.content.trim() : "";
    if (!content) return;

    const isStreaming = obj.isStreaming === true;
    // Skip mid-stream fragments — they're usually incomplete tracker payloads
    // and would overwrite the last good record with a partial one. The final
    // completed tag is delivered with isStreaming=false (or via MESSAGE_SENT /
    // MESSAGE_EDITED as a fallback).
    if (isStreaming) return;

    const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
    const messageId = typeof obj.messageId === "string" ? obj.messageId : null;
    if (chatId) activeChatId = chatId;

    lastSimStats = content;
    recordChatTracker(chatId, messageId, content);
    pushMacroValues();
    await trackEvent("sst.tracker.detected", { identifier: config.codeBlockIdentifier, source: "message_tag_intercepted" });
  })();
});

spindle.registerMacro({
  name: "sim_format",
  category: "extension:silly_sim_tracker",
  description: "Example tracker tag format",
  returnType: "string",
  handler: "",
});

spindle.registerMacro({
  name: "sim_tracker",
  category: "extension:silly_sim_tracker",
  description: "Main tracker instructions for the active template",
  returnType: "string",
  handler: "",
});

spindle.registerMacro({
  name: "last_sim_stats",
  category: "extension:silly_sim_tracker",
  description: "The latest tracker state as a compact Markdown list",
  returnType: "string",
  handler: "",
});

/**
 * Rewrite any instructions in the preset's sysPrompt that would lead the
 * LLM to emit a markdown code fence (e.g. ```sim ... ```) for tracker
 * data. The frontend's MESSAGE_TAG_INTERCEPTED path only fires on the
 * configured XML tag, so a fenced block silently bypasses tracker
 * capture, side-channel history, and secondary-LLM plumbing.
 *
 * Three passes, each targeting a different way the fence format leaks in:
 *   1. `\`\`\`<identifier> ... \`\`\`` fences — authors copy/paste these
 *      as literal examples. Rewritten as the XML wrapper so the example
 *      still shows the intended shape but in the correct format.
 *   2. `\`\`\`json` / `\`\`\`yaml` fences whose body looks like a tracker
 *      payload (references `worldData` / `characters` / a `"name"` key).
 *      Non-tracker code examples are left alone.
 *   3. Textual references like ``\`sim\` codeblock``, `Sim codeblock`,
 *      `DISP code block` — replaced with the tracker-tag terminology.
 */
/**
 * Push current macro values to the host so prompt assembly can resolve
 * them instantly without an RPC roundtrip to the worker.
 */
function pushMacroValues(): void {
  // sim_format
  const fmt = buildExampleTrackerBlock(config.trackerFormat, config.codeBlockIdentifier);
  spindle.updateMacroValue("sim_format", fmt);

  // sim_tracker — always resolve the *active* preset (built-in, seeded,
  // or user-imported) so switching the template dropdown actually swaps
  // the prompt the LLM sees. A static id→prompt map here previously
  // ignored anything outside the bundled defaults.
  const tag = sanitizeTagName(config.trackerTagName);
  const id = sanitizeIdentifier(config.codeBlockIdentifier);
  const rawBase = getActivePreset().sysPrompt || "";
  const base = sanitizeSysPromptForWireFormat(rawBase, tag, id);
  const directive = [
    "IMPORTANT OUTPUT FORMAT:",
    "Do not emit markdown code fences for tracker data.",
    "Emit a single XML block using this exact wrapper:",
    `<${tag} type="${id}">`,
    "{...tracker JSON or YAML...}",
    `</${tag}>`,
    "Narrative text must remain outside the tracker tag.",
  ].join("\n");
  let simTracker = base
    ? directive + "\n\n" + base.replace(/\{\{sim_format\}\}/g, fmt)
    : directive + "\n\n" + fmt;
  if (firstMessageFertilityHint) {
    simTracker += "\n\n" + firstMessageFertilityHint;
  }
  spindle.updateMacroValue("sim_tracker", simTracker);

  // last_sim_stats — expose a prompt-efficient Markdown view while keeping
  // lastSimStats itself in its parseable JSON/YAML form for commands.
  spindle.updateMacroValue("last_sim_stats", formatTrackerForPrompt(lastSimStats || "{}"));
}

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
  secondaryGenerationChain = secondaryGenerationChain
    .catch(() => undefined)
    .then(() => generateTrackerWithSecondaryLLM(chatId, messageId))
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
): Promise<void> {
  const trackerBlock = formatTrackerPayload(parsed, config.trackerFormat, config.codeBlockIdentifier);
  const updatedContent = `${targetMessage.content.trimEnd()}\n\n${trackerBlock}`;
  await spindle.chat.updateMessage(chatId, targetMessage.id, { content: updatedContent });

  lastSimStats = config.trackerFormat === "yaml"
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
  }, activeUserId || undefined);
}

async function generateTrackerWithSecondaryLLM(chatId: string, targetMessageId: string): Promise<void> {
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
    { type: "secondary_generation_started", chatId, messageId: targetMessageId },
    activeUserId || undefined,
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

    const preset = getActivePreset();
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
                { type: "secondary_generation_skipped", chatId, messageId: targetMessageId },
                activeUserId || undefined,
              );
              return;
            }
            if (gate === "fast") {
              const result = applyFastLaneAnswers(previousPayload, plan.directives, answers, config.typeSafeConfidenceFloor);
              if (result.changed.length > 0) {
                await commitTrackerAppend(chatId, targetMessage, result.payload, "typesafe-fast-lane");
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
        { type: "secondary_generation_error", message: guidance, chatId, messageId: targetMessageId },
        activeUserId || undefined,
      );
      return;
    }
    const connections = await spindle.connections.list(activeUserId || undefined);
    const route = resolveSecondaryConnection(connections, config.secondaryLLMConnectionId, trimmedModel);
    trimmedModel = route.model;
    if (!route.ok) {
      const guidance = route.reason === "provider"
        ? "Secondary LLM connection has no usable provider. Select a configured connection in SimTracker settings and try again."
        : describeMissingModelGuidance();
      spindle.log.warn(guidance);
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: guidance, chatId, messageId: targetMessageId },
        activeUserId || undefined,
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
      userId: activeUserId || undefined,
      provider,
      model: trimmedModel,
    };
    const result = await spindle.generate.raw(generationRequest as Parameters<typeof spindle.generate.raw>[0]);

    const resultObj = result as Record<string, unknown>;
    const generatedText = typeof resultObj.content === "string" ? resultObj.content : "";
    if (!generatedText) {
      spindle.log.warn("Secondary LLM returned empty response");
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: "Empty response from LLM", chatId, messageId: targetMessageId },
        activeUserId || undefined,
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
        { type: "secondary_generation_error", message: "LLM response was not valid tracker data after one repair attempt", chatId, messageId: targetMessageId },
        activeUserId || undefined,
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
              { type: "secondary_generation_error", message, chatId, messageId: targetMessageId },
              activeUserId || undefined,
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

    await commitTrackerAppend(chatId, targetMessage, parsed, "secondary-llm");
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
      { type: "secondary_generation_error", message, chatId, messageId: targetMessageId },
      activeUserId || undefined,
    );
    await trackEvent("sst.secondary_generation.failed", { error: rawMessage }, { level: "error" });
  }
}

// `GENERATION_STARTED` fires immediately before the interceptor runs and
// reliably carries the active chat id in its typed payload. Mirror it into
// `activeChatId` so the interceptor can fall back on it when its `context`
// argument (typed as `unknown` in the SDK) doesn't surface one. Also use
// this as the trigger to prime the side-channel for chats the extension
// hasn't observed activity on yet (e.g. first generation after reload).
spindle.on("GENERATION_STARTED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
    if (!chatId) return;
    activeChatId = chatId;
    await rehydrateChatTrackerHistory(chatId);

    // Brand-new chat: exactly one user message and no tracker history yet.
    // Bake the fertility-cycle seed hint into the {{sim_tracker}} macro so it
    // reaches the model alongside the tracker instructions.
    const previousHint = firstMessageFertilityHint;
    firstMessageFertilityHint = "";
    try {
      const isNewChat = getChatTrackerHistory(chatId).length === 0
        && await (async () => {
          const msgs = await spindle.chat.getMessages(chatId);
          return msgs.filter((m) => m.role === "user").length === 1;
        })();
      if (isNewChat) {
        firstMessageFertilityHint = buildFirstMessageHint(config.fertilityCycleBias);
      }
    } catch {
      // If message introspection fails, leave the hint empty.
    }
    if (previousHint !== firstMessageFertilityHint) pushMacroValues();
  })();
});

spindle.on("CHAT_SWITCHED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    const chatId = typeof obj.chatId === "string"
      ? obj.chatId
      : typeof obj.chat_id === "string"
        ? obj.chat_id
        : null;
    if (chatId) activeChatId = chatId;
    if (chatId) {
      void rehydrateChatTrackerHistory(chatId);
    }
  })();
});

// When a message disappears, evict its side-channel entry. Without this,
// `getRecentChatTrackers` would still surface the deleted message's
// tracker as "previous state" on a future regenerate, and the side panel
// could keep pointing at a row the user removed.
spindle.on("MESSAGE_DELETED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    const ctx = readMessageContext(payload);
    if (!ctx.chatId || !ctx.messageId) return;
    forgetChatTracker(ctx.chatId, ctx.messageId);
    spindle.log.info(`Forgot tracker side-channel entry for deleted message ${ctx.messageId} in chat ${ctx.chatId}`);
  })();
});

spindle.on("GENERATION_ENDED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    const ctx = readMessageContext(payload);
    if (ctx.chatId) {
      activeChatId = ctx.chatId;
      void rehydrateChatTrackerHistory(ctx.chatId);
    }

    if (!config.useSecondaryLLM) return;
    if (!hasPermission("generation") || !hasPermission("chat_mutation")) return;
    if (!ctx.chatId) return;

    let chatMessages: Array<{ id: string; role: "system" | "user" | "assistant"; content: string }>;
    try {
      chatMessages = await spindle.chat.getMessages(ctx.chatId);
    } catch {
      return;
    }

    const latestAssistant = chatMessages.findLast((m) => m.role === "assistant");
    if (!latestAssistant) return;

    // If the latest assistant already has a tracker in its canonical content,
    // capture it into the side-channel before skipping secondary generation
    // — that way future runs still see it even if subsequent edits/swipes
    // strip the tag.
    const existingPayload = extractTrackerPayloadFromMessage(latestAssistant.content);
    if (existingPayload) {
      recordChatTracker(ctx.chatId, latestAssistant.id, existingPayload);
      return;
    }

    // Enqueue serially — never drop a request because a previous secondary
    // is still in flight, which is what caused "last message sometimes has
    // no tracker" when users replied faster than the sidecar completed.
    void enqueueSecondaryGeneration(ctx.chatId, latestAssistant.id);
  })();
});

const { stripOldTrackerBlocksGlobal, formatTrackerBlocksInMessages, countTrackersInMessages, buildTrackerInjectionBlock, withTrailingDirective } = createTrackerPromptRetention(() => config, trackerMessageCodec);

/**
 * Best-effort resolution of the chat id associated with the current
 * interceptor invocation. The SDK types the `context` parameter as
 * `unknown`, so we probe a few common shapes and then fall back on
 * `activeChatId` (populated from `GENERATION_STARTED` and friends).
 */
function resolveInterceptorChatId(context: unknown): string | null {
  if (context && typeof context === "object") {
    const obj = context as Record<string, unknown>;
    const candidates: unknown[] = [
      obj.chatId,
      obj.chat_id,
      (obj.chat as Record<string, unknown> | undefined)?.id,
      (obj.generation as Record<string, unknown> | undefined)?.chatId,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length > 0) return c;
    }
  }
  return activeChatId;
}

let interceptorRegistered = false;

function tryRegisterInterceptor(): void {
  if (interceptorRegistered) return;
  if (!hasPermission("interceptor")) return;

  try {
    spindle.registerInterceptor(async (messages: LlmMessageDTO[], context: unknown) => {
      const keepNewest = config.retainTrackerCount;
      if (keepNewest < 0) return messages;
      if (!Array.isArray(messages) || messages.length === 0) return messages;

      // 1. Strip older tracker blocks so the prompt never exceeds the
      //    user's retention limit.
      const retained = stripOldTrackerBlocksGlobal(messages, config.codeBlockIdentifier, keepNewest);

      // If the user explicitly set `retainTrackerCount` to 0 they want a
      // clean context — skip injection entirely.
      if (keepNewest === 0) return retained;

      // 2. Resolve the chat and prime the side-channel (idempotent) before
      //    anything reads tracker history.
      const chatId = resolveInterceptorChatId(context);

      // ── Conception gate ───────────────────────────────────────────────
      // Check the very latest tracker for characters in the fertile window
      // (ovulation / rut / early-luteal) with womb fullness above
      // threshold. Auto-pass at 100 %; the gray zone below that is decided
      // by TypeSafe weighing the fertility factors against the scene
      // narrative (coin flip when TypeSafe is unavailable). On a pass:
      //   1. Plan a mutation of the stored payload to add `conceived: true`.
      //   2. Commit the mutation to chatTrackerHistory so future turns
      //      inherit the authoritative state.
      //   3. Rewrite the matching tracker block in the in-flight messages
      //      array so the LLM sees only the mutated version this turn.
      //   4. Inject a reminder directive as a belt-and-braces backstop.
      // The gate runs on every interception — including turns where enough
      // trackers already sit in the prompt — so the mutation and directive
      // never depend on the back-fill path below.
      let conceptionDirective = "";
      if (chatId) {
        await rehydrateChatTrackerHistory(chatId);
        const preMutationLatest = getRecentChatTrackers(chatId, 1);
        const latestPayload = preMutationLatest.length > 0
          ? parseTrackerPayload(preMutationLatest[preMutationLatest.length - 1].payload)
          : null;
        if (latestPayload) {
          const conceptionNames = await checkConceptionTriggers(chatId, latestPayload, latestNarrativeBeat(retained));
          if (conceptionNames.length > 0) {
            const plan = planForcedConception(getChatTrackerHistory(chatId), conceptionNames, extractCurrentDate(latestPayload));
            if (plan) {
              commitForcedConception(chatId, plan);
              rewriteTrackerInMessages(retained, plan.oldPayload, plan.newPayload, extractTrackerPayloadFromMessage);
            }
            conceptionDirective = buildConceptionDirective(conceptionNames);
          }
        }
      }

      // 3. Count how many tracker blocks remain after stripping.  If we
      //    already have enough, the LLM can reference them directly — but
      //    still deliver any conception directive from the gate above.
      const currentCount = countTrackersInMessages(retained, keepNewest);
      if (currentCount >= keepNewest) {
        return withTrailingDirective(formatTrackerBlocksInMessages(retained), conceptionDirective);
      }

      // 4. Otherwise the prompt is short on tracker history (usually because
      //    the frontend's tag interceptor has `removeFromMessage: true`).
      //    Back-fill the difference from the side-channel so the main LLM
      //    still sees the last N tracker states.
      if (!chatId) return formatTrackerBlocksInMessages(retained);

      const needed = keepNewest - currentCount;


      // Fetch the most recent entries (post-mutation); we may discard
      // duplicates already represented in the assembled prompt.
      const history = getRecentChatTrackers(chatId, keepNewest);
      if (history.length === 0) {
        // No tracker history to inject yet; the first-message fertility hint
        // (if any) is already baked into the {{sim_tracker}} macro value.
        return withTrailingDirective(formatTrackerBlocksInMessages(retained), conceptionDirective);
      }

      const existingPayloads = new Set<string>();
      for (const msg of retained) {
        if (!msg || typeof msg.content !== "string") continue;
        const payload = extractTrackerPayloadFromMessage(msg.content);
        if (payload) existingPayloads.add(payload.trim());
      }

      const toInject = history
        .slice()
        .reverse() // newest first
        .filter((entry) => !existingPayloads.has(entry.payload.trim()))
        .slice(0, needed)
        .reverse(); // back to oldest → newest

      if (toInject.length === 0) return withTrailingDirective(formatTrackerBlocksInMessages(retained), conceptionDirective);

      const block = buildTrackerInjectionBlock(toInject);
      const promptMessages = formatTrackerBlocksInMessages(retained);

      // Prefer appending to the last assistant message in the array so the
      // tracker appears exactly where the LLM would normally have emitted
      // it in its previous turn. Fall back to synthesising a trailing
      // system message if there's no assistant message yet (first-turn
      // generation, re-greeting, etc.).
      let lastAssistantIdx = -1;
      for (let i = promptMessages.length - 1; i >= 0; i -= 1) {
        const m = promptMessages[i];
        if (m && m.role === "assistant" && typeof m.content === "string") {
          lastAssistantIdx = i;
          break;
        }
      }

      if (lastAssistantIdx >= 0) {
        const injected = promptMessages.slice();
        const target = injected[lastAssistantIdx];
        const base = typeof target.content === "string" ? target.content.trimEnd() : "";
        injected[lastAssistantIdx] = {
          ...target,
          content: base ? `${base}\n\n${block}` : block,
        };
        return withTrailingDirective(injected, conceptionDirective);
      }

      // Insert a synthetic system message near the end of the conversation
      // so the LLM still picks up the prior tracker state.
      const injected = promptMessages.slice();
      const insertAt = Math.max(0, injected.length - 1);
      injected.splice(insertAt, 0, { role: "system", content: block });
      return withTrailingDirective(injected, conceptionDirective);
    }, 90);
    interceptorRegistered = true;
    spindle.log.info("Interceptor registered");
  } catch {
    spindle.log.warn("Interceptor registration failed");
  }
}

// Attempt initial interceptor registration
tryRegisterInterceptor();

async function initGrantedPermissions(): Promise<void> {
  try {
    const granted = await spindle.permissions.getGranted();
    runtime.grantedPermissions = new Set(granted);
    spindle.log.info(`Granted permissions: ${granted.join(", ") || "none"}`);
  } catch {
    runtime.grantedPermissions = new Set();
    spindle.log.warn("Unable to read granted permissions");
  }
}

async function refreshGrantedPermissions(): Promise<void> {
  try {
    const granted = await spindle.permissions.getGranted();
    runtime.grantedPermissions = new Set(granted);
  } catch {
    // Keep last known permissions snapshot.
  }
}

// ── Real-time Permission Gating ──────────────────────────────────────

spindle.permissions.onChanged(({ permission, granted, allGranted }) => {
  runtime.grantedPermissions = new Set(allGranted);
  spindle.log.info(
    `Permission "${permission}" ${granted ? "granted" : "revoked"} — active: ${allGranted.join(", ") || "none"}`,
  );

  // Re-register interceptor if it becomes available
  if (permission === "interceptor" && granted) {
    tryRegisterInterceptor();
  }

  // Push updated permission state to frontend
  spindle.sendToFrontend({
    type: "permission_changed",
    permission,
    granted,
    allGranted,
  }, activeUserId || undefined);
});

spindle.permissions.onDenied(({ permission, operation }) => {
  spindle.log.warn(`Permission "${permission}" denied for operation: ${operation}`);
});

async function getEphemeralPoolStatusSafe(): Promise<Record<string, unknown> | null> {
  if (!hasPermission("ephemeral_storage")) return null;
  try {
    return await spindle.ephemeral.getPoolStatus();
  } catch {
    return null;
  }
}

function sendConfigError(userId: string, message: string, operation: "load" | "save" = "load"): void {
  try {
    spindle.sendToFrontend({ type: "config_error", message, operation }, userId);
  } catch {
    // If frontend delivery itself fails, the backend log is the remaining signal.
  }
}

async function sendConfigState(userId: string, configToSend: TrackerConfig = config): Promise<void> {
  const [, ephemeralPoolStatus] = await Promise.all([
    loadSeededTemplatePresets(),
    (async () => {
      await refreshGrantedPermissions();
      return getEphemeralPoolStatusSafe();
    })(),
  ]);
  spindle.sendToFrontend({
    type: "config",
    config: configToSend,
    grantedPermissions: Array.from(runtime.grantedPermissions),
    requestedPermissions: spindle.manifest?.permissions || [],
    seededPresets: runtime.seededPresets,
    ephemeralPoolStatus,
  }, userId);
}

function sendTagInterceptorConfig(userId: string, configToSend: TrackerConfig = config): void {
  spindle.sendToFrontend({
    type: "tag_interceptor_config",
    tagName: configToSend.trackerTagName,
    tagType: configToSend.codeBlockIdentifier,
    removeFromMessage: configToSend.hideSimBlocks,
  }, userId);
}

spindle.onFrontendMessage(async (payload: unknown, userId: string) => {
  if (!payload || typeof payload !== "object") return;
  activeUserId = userId;
  const message = payload as Record<string, unknown>;

  if (message.type === "get_config") {
    try {
      await loadConfig(userId);
      // Unblock chat display before the heavier template/permission/status
      // bootstrap. The frontend can strip tags immediately and defer rendering
      // until the authoritative latest-tracker lookup completes.
      sendTagInterceptorConfig(userId);
      await sendConfigState(userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spindle.log.error(`get_config handler failed: ${msg}`);
      sendConfigError(userId, msg, "load");
    }
    return;
  }
  if (message.type === "set_config") {
    try {
      await ensureConfigForUser(userId);
      const incoming = message.config as Partial<TrackerConfig>;
      const previousTypeSafeKey = config.typeSafeApiKey.trim();
      config = mergeTrackerConfig(config, incoming);
      await syncTypeSafeKeyToEnclave(userId, config.typeSafeApiKey, previousTypeSafeKey);
      await saveConfig(userId);
      pushMacroValues();
      await trackEvent("sst.config.updated", {
        trackerTagName: config.trackerTagName,
        templateId: config.templateId,
        trackerFormat: config.trackerFormat,
        retainTrackerCount: config.retainTrackerCount,
        hideSimBlocks: config.hideSimBlocks,
        useSecondaryLLM: config.useSecondaryLLM,
      });
      await sendConfigState(userId);
      spindle.sendToFrontend({ type: "config_saved" }, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spindle.log.error(`set_config handler failed for user ${userId}: ${msg}`);
      sendConfigError(userId, msg, "save");
    }
    return;
  }

  if (message.type === "get_connections") {
    if (!hasPermission("generation")) {
      spindle.log.warn("get_connections: 'generation' permission not granted");
      spindle.sendToFrontend({
        type: "connections_list",
        connections: [],
        error: "Generation permission not granted",
      }, userId);
      return;
    }
    try {
      spindle.log.info(`get_connections: requesting with userId=${userId || "(none)"}`);
      const connections = await spindle.connections.list(userId || undefined);
      spindle.log.info(`get_connections: received ${connections?.length ?? 0} connection(s)`);
      spindle.sendToFrontend({ type: "connections_list", connections: connections ?? [] }, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spindle.log.error(`get_connections failed: ${msg}`);
      spindle.sendToFrontend({ type: "connections_list", connections: [], error: msg }, userId);
    }
    return;
  }

  if (message.type === "trigger_secondary_generation") {
    const chatId = typeof message.chatId === "string" ? message.chatId : null;
    const messageId = typeof message.messageId === "string" ? message.messageId : null;
    if (chatId && messageId) {
      void enqueueSecondaryGeneration(chatId, messageId);
    }
    return;
  }

  if (message.type === "regenerate_secondary_tracker") {
    const chatId = typeof message.chatId === "string" ? message.chatId : null;
    const hintedMessageId = typeof message.messageId === "string" ? message.messageId : null;
    if (!chatId) return;
    if (!hasPermission("chat_mutation")) {
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: "Regenerate requires 'chat_mutation' permission" },
        userId,
      );
      return;
    }

    const messages = await spindle.chat.getMessages(chatId);
    let target = hintedMessageId
      ? messages.find((m) => m.id === hintedMessageId && m.role === "assistant") || null
      : null;
    // Fall back to the most recent assistant message — whether or not it
    // already carries a tracker — so the user can ask for a fresh generation
    // even on a message that's never been processed yet.
    if (!target) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === "assistant") {
          target = messages[i];
          break;
        }
      }
    }
    if (!target) {
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: "No assistant message was found in this chat to regenerate." },
        userId,
      );
      return;
    }

    const tagRe = buildTrackerTagRegex(sanitizeTagName(config.trackerTagName), "gi");
    const fenceRe = buildTrackerFenceRegex(config.codeBlockIdentifier, "gi");
    const hadTracker = extractTrackerPayloadFromMessage(target.content) !== null;
    if (hadTracker) {
      const stripped = target.content.replace(tagRe, "").replace(fenceRe, "").replace(/\n{3,}/g, "\n\n").trimEnd();
      spindle.log.info(`Regenerate: stripping existing tracker from message ${target.id} in chat ${chatId}`);
      await spindle.chat.updateMessage(chatId, target.id, { content: stripped });
      forgetChatTracker(chatId, target.id);
    } else {
      spindle.log.info(`Regenerate: message ${target.id} in chat ${chatId} has no tracker yet — generating fresh`);
    }

    void enqueueSecondaryGeneration(chatId, target.id);
    return;
  }

  if (message.type === "get_latest_tracker") {
    const chatId = typeof message.chatId === "string" ? message.chatId : null;
    if (!chatId) {
      spindle.sendToFrontend({ type: "tracker_history_latest", chatId: null, entry: null }, userId);
      return;
    }
    activeChatId = chatId;
    await rehydrateChatTrackerHistory(chatId);
    const history = getChatTrackerHistory(chatId);
    const entry = history.length > 0 ? history[history.length - 1] : null;
    const previousEntry = history.length > 1 ? history[history.length - 2] : null;
    spindle.sendToFrontend({
      type: "tracker_history_latest",
      chatId,
      entry: entry
        ? {
            messageId: entry.messageId,
            payload: entry.payload,
            previousPayload: previousEntry?.payload || null,
          }
        : null,
    }, userId);
    return;
  }

  if (message.type === "remove_inline_pack") {
    const index = typeof message.index === "number" ? message.index : -1;
    if (index >= 0 && index < config.inlinePacks.length) {
      const next = config.inlinePacks.slice();
      next.splice(index, 1);
      config = { ...config, inlinePacks: next };
      await saveConfig(userId);
      pushMacroValues();
      await sendConfigState(userId);
    }
    return;
  }

  if (message.type === "toggle_inline_pack") {
    const index = typeof message.index === "number" ? message.index : -1;
    const enabled = typeof message.enabled === "boolean" ? message.enabled : true;
    if (index >= 0 && index < config.inlinePacks.length) {
      const next = config.inlinePacks.slice();
      next[index] = { ...(next[index] as Record<string, unknown>), enabled };
      config = { ...config, inlinePacks: next };
      await saveConfig(userId);
      pushMacroValues();
      await sendConfigState(userId);
    }
    return;
  }

  if (message.type === "import_preset_file") {
    await handleImportPresetFile(message, userId);
  }
});

await initGrantedPermissions();
spindle.log.info("Silly Sim Tracker (Lumiverse) backend started");

export {};
