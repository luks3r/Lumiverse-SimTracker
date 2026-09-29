import type { SpindleAPI } from "lumiverse-spindle-types";
import type { TrackerConfig } from "../shared/trackerConfig";
import type { ConceptionMutation } from "./conceptionFlow";
import type { TrackerHistoryEntry } from "./trackerHistory";
import { CONCEPTION_CONFIG, coinFlip, getCharactersFromPayload, isAlreadyConceivedOrPregnant, isFemaleOrFuta, isInFertileWindow } from "./conceptionRules";
import {
  buildConceptionQuestions,
  evaluateTypeSafe,
  interpretConceptionAnswers,
  type ConceptionCandidate,
  VERIFY_NARRATIVE_CHAR_CAP,
  type TypeSafeCorsTransport,
} from "./typesafe";

export function createConceptionGate(deps: {
  spindle: SpindleAPI;
  readConfig: () => TrackerConfig;
  hasPermission: (name: string) => boolean;
  typeSafeCorsTransport: TypeSafeCorsTransport;
  trackEvent: (eventName: string, payload?: Record<string, unknown>, options?: { level?: "debug" | "info" | "warn" | "error"; chatId?: string }) => Promise<void>;
  getChatTrackerHistory: (chatId: string | null) => TrackerHistoryEntry[];
}) {
  const { spindle, hasPermission, typeSafeCorsTransport, trackEvent, getChatTrackerHistory } = deps;
  // Suppress duplicate notices until a later payload marks conception.
  const conceptionNotified = new Set<string>();
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
  if (deps.readConfig().typeSafeEnabled && deps.readConfig().typeSafeConception && deps.readConfig().typeSafeApiKey.trim() && hasPermission("cors_proxy")) {
    try {
      const plan = buildConceptionQuestions(candidates);
      const answers = await evaluateTypeSafe(
        typeSafeCorsTransport,
        { apiKey: deps.readConfig().typeSafeApiKey.trim(), model: deps.readConfig().typeSafeModel },
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
  return { checkConceptionTriggers, commitForcedConception };
}
