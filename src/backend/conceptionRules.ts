/**
 * Conception-gate config.  Threshold is the womb fullness % strictly above
 * which the coin-flip fires (auto-pass at 100 %).  Eligibility window is
 * ovulation, rut, or early luteal (days 17-19).  Triggered characters get
 * their stored tracker mutated in-place to set `conceived: true` so the
 * LLM sees the authoritative state on the next turn.
 */
export const CONCEPTION_CONFIG = {
  threshold: 85,
  autoAt: 100,
  earlyLutealMaxDay: 19,
};

export type CharacterStats = Record<string, unknown>;

export function getCharactersFromPayload(payload: Record<string, unknown>): CharacterStats[] {
  const chars = payload.characters;
  if (!Array.isArray(chars)) return [];
  return chars.filter((c): c is CharacterStats => c && typeof c === "object" && !Array.isArray(c));
}

export function isFemaleOrFuta(stats: CharacterStats): boolean {
  const sex = String(stats.sex || "").toLowerCase();
  return ["female", "futanari", "futa", "both", "intersex", "hermaphrodite"].includes(sex);
}

function isOvulating(stats: CharacterStats): boolean {
  const stage = String(stats.cycle_stage || "").toLowerCase();
  const stageId = Number(stats.cycle_stage_id || 0);
  return stage === "ovulation" || stageId === 3;
}

export function isInFertileWindow(stats: CharacterStats): boolean {
  const stage = String(stats.cycle_stage || "").toLowerCase();
  const stageId = Number(stats.cycle_stage_id || 0);
  if (stage === "ovulation" || stageId === 3) return true;
  if (stage === "rut" || stageId === 6) return true;
  if (stage === "luteal" || stageId === 4) {
    const day = Number(stats.cycle_day || 0);
    return day > 0 && day <= CONCEPTION_CONFIG.earlyLutealMaxDay;
  }
  return false;
}

export function extractCurrentDate(payload: Record<string, unknown>): string {
  const world = payload.worldData as Record<string, unknown> | undefined;
  const date = world?.current_date;
  if (typeof date === "string" && date.trim()) return date.trim();
  return new Date().toISOString().slice(0, 10);
}

export function isAlreadyConceivedOrPregnant(stats: CharacterStats): boolean {
  return stats.preg === true || stats.conceived === true || stats.conception_date === true;
}

export function coinFlip(): boolean {
  return Math.random() < 0.5;
}
