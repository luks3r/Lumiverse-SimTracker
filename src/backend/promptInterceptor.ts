import type { SpindleAPI, LlmMessageDTO } from "lumiverse-spindle-types";
import type { TrackerConfig } from "../shared/trackerConfig";
import type { createTrackerMessageCodec } from "./trackerMessageCodec";
import type { TrackerHistoryEntry } from "./trackerHistory";
import { createTrackerPromptRetention } from "./trackerPromptRetention";
import { parseTrackerPayload } from "./trackerPayload";
import { buildConceptionDirective, latestNarrativeBeat, planForcedConception, rewriteTrackerInMessages, type ConceptionMutation } from "./conceptionFlow";
import { extractCurrentDate } from "./conceptionRules";

export function createPromptInterceptor(deps: {
  spindle: SpindleAPI;
  readConfig: () => TrackerConfig;
  readActiveChatId: () => string | null;
  hasPermission: (name: string) => boolean;
  trackerMessageCodec: ReturnType<typeof createTrackerMessageCodec>;
  rehydrateChatTrackerHistory: (chatId: string | null) => Promise<void>;
  getRecentChatTrackers: (chatId: string, limit: number) => TrackerHistoryEntry[];
  getChatTrackerHistory: (chatId: string | null) => TrackerHistoryEntry[];
  extractTrackerPayloadFromMessage: (content: string) => string | null;
  checkConceptionTriggers: (chatId: string | null, payload: Record<string, unknown>, narrative: string) => Promise<string[]>;
  commitForcedConception: (chatId: string, plan: ConceptionMutation) => void;
}) {
  const {
    spindle,
    hasPermission,
    trackerMessageCodec,
    rehydrateChatTrackerHistory,
    getRecentChatTrackers,
    getChatTrackerHistory,
    extractTrackerPayloadFromMessage,
    checkConceptionTriggers,
    commitForcedConception,
  } = deps;
const { stripOldTrackerBlocksGlobal, formatTrackerBlocksInMessages, countTrackersInMessages, buildTrackerInjectionBlock, withTrailingDirective } = createTrackerPromptRetention(deps.readConfig, trackerMessageCodec);

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
  return deps.readActiveChatId();
}

let interceptorRegistered = false;

function tryRegisterInterceptor(): void {
  if (interceptorRegistered) return;
  if (!hasPermission("interceptor")) return;

  try {
    spindle.registerInterceptor(async (messages: LlmMessageDTO[], context: unknown) => {
      const keepNewest = deps.readConfig().retainTrackerCount;
      if (keepNewest < 0) return messages;
      if (!Array.isArray(messages) || messages.length === 0) return messages;

      // 1. Strip older tracker blocks so the prompt never exceeds the
      //    user's retention limit.
      const retained = stripOldTrackerBlocksGlobal(messages, deps.readConfig().codeBlockIdentifier, keepNewest);

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
  return { tryRegisterInterceptor };
}
