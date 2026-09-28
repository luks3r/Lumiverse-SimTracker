import { DEFAULT_CONFIG, FERTILITY_CYCLE_BIAS_VALUES, type FertilityCycleBias } from "./trackerConfig";

export function sanitizeTrackerFormat(value: unknown): "json" | "yaml" {
  return value === "yaml" ? "yaml" : "json";
}

export function sanitizeTemplateId(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CONFIG.templateId;
  const trimmed = value.trim();
  return trimmed || DEFAULT_CONFIG.templateId;
}

export function sanitizeRetainCount(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_CONFIG.retainTrackerCount;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

export function sanitizeInlineEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_CONFIG.enableInlineTemplates;
}

export function sanitizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeStr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function sanitizeFertilityCycleBias(value: unknown): FertilityCycleBias {
  return typeof value === "string" && (FERTILITY_CYCLE_BIAS_VALUES as readonly string[]).includes(value)
    ? (value as FertilityCycleBias)
    : DEFAULT_CONFIG.fertilityCycleBias;
}

/**
 * Coerce known placeholder model strings (Spindle's connection-profile UI
 * seeds the field with literal "string", and users sometimes paste an
 * unfilled example) to empty so they fall the secondary-LLM pre-flight
 * check instead of silently 400ing at the provider.
 */
export function sanitizeSecondaryLLMModel(value: unknown, fallback: string): string {
  const raw = sanitizeStr(value, fallback);
  const lowered = raw.toLowerCase();
  if (lowered === "string" || lowered === "your-model-here" || lowered === "model" || lowered === "null" || lowered === "undefined") {
    return "";
  }
  return raw;
}

export function sanitizeMessageCount(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_CONFIG.secondaryLLMMessageCount;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

export function sanitizeTemperature(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return DEFAULT_CONFIG.secondaryLLMTemperature;
  return Math.max(0, Math.min(2, Math.round(value * 100) / 100));
}

export function sanitizeTypeSafeModel(value: unknown): string {
  const model = sanitizeStr(value, DEFAULT_CONFIG.typeSafeModel);
  return model || DEFAULT_CONFIG.typeSafeModel;
}

export function sanitizeConfidenceFloor(value: unknown): number {
  const floor = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_CONFIG.typeSafeConfidenceFloor;
  return Math.min(0.95, Math.max(0.3, Math.round(floor * 100) / 100));
}
