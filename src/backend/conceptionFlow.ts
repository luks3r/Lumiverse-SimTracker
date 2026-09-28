import { getCharactersFromPayload } from "./conceptionRules";
import { parseTrackerPayload } from "./trackerPayload";
import type { TrackerHistoryEntry } from "./trackerHistory";

export type ConceptionMutation = {
  messageId: string;
  oldPayload: string;
  newPayload: string;
};

/** Latest non-empty user message in the in-flight prompt. */
export function latestNarrativeBeat(messages: Array<{ role?: unknown; content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "user" || typeof msg.content !== "string" || !msg.content.trim()) continue;
    return msg.content;
  }
  return "";
}

/** Plan the update; the caller commits it to history after the gate passes. */
export function planForcedConception(
  history: TrackerHistoryEntry[],
  names: string[],
  conceptionDate: string,
): ConceptionMutation | null {
  if (names.length === 0 || history.length === 0) return null;
  const latest = history[history.length - 1];
  const parsed = parseTrackerPayload(latest.payload);
  if (!parsed) return null;

  const characters = getCharactersFromPayload(parsed as Record<string, unknown>);
  let mutated = false;

  for (const char of characters) {
    if (typeof char.name !== "string" || !names.includes(char.name)) continue;
    if (char.preg === true || char.conceived === true) continue;
    char.conceived = true;
    if (typeof char.conception_date !== "string" || !char.conception_date.trim()) {
      char.conception_date = conceptionDate;
    }
    mutated = true;
  }

  if (!mutated) return null;

  const newPayload = JSON.stringify(parsed, null, 2);
  return { messageId: latest.messageId, oldPayload: latest.payload, newPayload };
}

/** Rewrite matching in-flight tracker text without touching persisted chat state. */
export function rewriteTrackerInMessages(
  messages: Array<{ content?: unknown }>,
  oldPayload: string,
  newPayload: string,
  extractTrackerPayloadFromMessage: (content: string) => string | null,
): void {
  const oldTrim = oldPayload.trim();
  if (!oldTrim || oldTrim === newPayload.trim()) return;
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg || typeof msg.content !== "string") continue;
    const found = extractTrackerPayloadFromMessage(msg.content);
    if (!found || found.trim() !== oldTrim) continue;
    messages[i] = { ...msg, content: msg.content.replace(oldPayload, newPayload) };
  }
}

export function buildConceptionDirective(names: string[]): string {
  if (names.length === 0) return "";
  const subject = names.length === 1 ? names[0] : names.join(", ");
  const verb = names.length === 1 ? "has" : "have";
  const pronoun = names.length === 1 ? "her" : "them";
  return `CONCEPTION DIRECTIVE: ${subject} ${verb} conceived. The prior tracker has been updated in-place to reflect this — \`conceived: true\` with \`conception_date\` set. PRESERVE this state on the next tracker emission; do not revert ${pronoun} to \`conceived: false\`. Do NOT set \`preg: true\` yet; that transition happens later as the narrative reveals the pregnancy.`;
}
