import { DEFAULT_CONFIG, FERTILITY_CYCLE_BIAS_VALUES, type FertilityCycleBias, type TrackerConfig } from "../shared/trackerConfig";
import { sanitizeInlinePacks, sanitizePresetArray } from "./presetSanitizers";
import { sanitizeIdentifier, sanitizeTagName } from "../shared/trackerSyntax";

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

export function normalizeStoredConfig(parsed: Partial<TrackerConfig>): TrackerConfig {
  return {
    trackerTagName: sanitizeTagName(parsed.trackerTagName),
    codeBlockIdentifier: sanitizeIdentifier(parsed.codeBlockIdentifier),
    hideSimBlocks: sanitizeBool(parsed.hideSimBlocks, DEFAULT_CONFIG.hideSimBlocks),
    templateId: sanitizeTemplateId(parsed.templateId),
    trackerFormat: sanitizeTrackerFormat(parsed.trackerFormat),
    retainTrackerCount: sanitizeRetainCount(parsed.retainTrackerCount),
    enableInlineTemplates: sanitizeInlineEnabled(parsed.enableInlineTemplates),
    userPresets: sanitizePresetArray(parsed.userPresets),
    inlinePacks: sanitizeInlinePacks(parsed.inlinePacks),
    useSecondaryLLM: sanitizeBool(parsed.useSecondaryLLM, DEFAULT_CONFIG.useSecondaryLLM),
    secondaryLLMConnectionId: sanitizeStr(parsed.secondaryLLMConnectionId, DEFAULT_CONFIG.secondaryLLMConnectionId),
    secondaryLLMModel: sanitizeSecondaryLLMModel(parsed.secondaryLLMModel, DEFAULT_CONFIG.secondaryLLMModel),
    secondaryLLMMessageCount: sanitizeMessageCount(parsed.secondaryLLMMessageCount),
    secondaryLLMTemperature: sanitizeTemperature(parsed.secondaryLLMTemperature),
    secondaryLLMStripHTML: sanitizeBool(parsed.secondaryLLMStripHTML, DEFAULT_CONFIG.secondaryLLMStripHTML),
    secondaryLLMJsonResponseFormat: sanitizeBool(parsed.secondaryLLMJsonResponseFormat, DEFAULT_CONFIG.secondaryLLMJsonResponseFormat),
    fertilityCycleBias: sanitizeFertilityCycleBias(parsed.fertilityCycleBias),
    typeSafeEnabled: sanitizeBool(parsed.typeSafeEnabled, DEFAULT_CONFIG.typeSafeEnabled),
    typeSafeApiKey: "", // resolved from the enclave below, never from disk
    typeSafeModel: sanitizeTypeSafeModel(parsed.typeSafeModel),
    typeSafeQuickAppend: sanitizeBool(parsed.typeSafeQuickAppend, DEFAULT_CONFIG.typeSafeQuickAppend),
    typeSafeVerify: sanitizeBool(parsed.typeSafeVerify, DEFAULT_CONFIG.typeSafeVerify),
    typeSafeConception: sanitizeBool(parsed.typeSafeConception, DEFAULT_CONFIG.typeSafeConception),
    typeSafeConfidenceFloor: sanitizeConfidenceFloor(parsed.typeSafeConfidenceFloor),
  };
}

export function mergeTrackerConfig(config: TrackerConfig, incoming: Record<string, unknown> | undefined): TrackerConfig {
  return {
    trackerTagName: sanitizeTagName(incoming?.trackerTagName ?? config.trackerTagName),
    codeBlockIdentifier: sanitizeIdentifier(incoming?.codeBlockIdentifier ?? config.codeBlockIdentifier),
    hideSimBlocks: sanitizeBool(incoming?.hideSimBlocks ?? config.hideSimBlocks, config.hideSimBlocks),
    templateId: sanitizeTemplateId(incoming?.templateId ?? config.templateId),
    trackerFormat: sanitizeTrackerFormat(incoming?.trackerFormat ?? config.trackerFormat),
    retainTrackerCount: sanitizeRetainCount(incoming?.retainTrackerCount ?? config.retainTrackerCount),
    enableInlineTemplates: sanitizeInlineEnabled(incoming?.enableInlineTemplates ?? config.enableInlineTemplates),
    userPresets: sanitizePresetArray(incoming?.userPresets ?? config.userPresets),
    inlinePacks: sanitizeInlinePacks(incoming?.inlinePacks ?? config.inlinePacks),
    useSecondaryLLM: sanitizeBool(incoming?.useSecondaryLLM ?? config.useSecondaryLLM, config.useSecondaryLLM),
    secondaryLLMConnectionId: sanitizeStr(incoming?.secondaryLLMConnectionId ?? config.secondaryLLMConnectionId, config.secondaryLLMConnectionId),
    secondaryLLMModel: sanitizeSecondaryLLMModel(incoming?.secondaryLLMModel ?? config.secondaryLLMModel, config.secondaryLLMModel),
    secondaryLLMMessageCount: sanitizeMessageCount(incoming?.secondaryLLMMessageCount ?? config.secondaryLLMMessageCount),
    secondaryLLMTemperature: sanitizeTemperature(incoming?.secondaryLLMTemperature ?? config.secondaryLLMTemperature),
    secondaryLLMStripHTML: sanitizeBool(incoming?.secondaryLLMStripHTML ?? config.secondaryLLMStripHTML, config.secondaryLLMStripHTML),
    secondaryLLMJsonResponseFormat: sanitizeBool(incoming?.secondaryLLMJsonResponseFormat ?? config.secondaryLLMJsonResponseFormat, config.secondaryLLMJsonResponseFormat),
    fertilityCycleBias: sanitizeFertilityCycleBias(incoming?.fertilityCycleBias ?? config.fertilityCycleBias),
    typeSafeEnabled: sanitizeBool(incoming?.typeSafeEnabled ?? config.typeSafeEnabled, config.typeSafeEnabled),
    typeSafeApiKey: sanitizeStr(incoming?.typeSafeApiKey ?? config.typeSafeApiKey, config.typeSafeApiKey),
    typeSafeModel: sanitizeTypeSafeModel(incoming?.typeSafeModel ?? config.typeSafeModel),
    typeSafeQuickAppend: sanitizeBool(incoming?.typeSafeQuickAppend ?? config.typeSafeQuickAppend, config.typeSafeQuickAppend),
    typeSafeVerify: sanitizeBool(incoming?.typeSafeVerify ?? config.typeSafeVerify, config.typeSafeVerify),
    typeSafeConception: sanitizeBool(incoming?.typeSafeConception ?? config.typeSafeConception, config.typeSafeConception),
    typeSafeConfidenceFloor: sanitizeConfidenceFloor(incoming?.typeSafeConfidenceFloor ?? config.typeSafeConfidenceFloor),
  };
}
