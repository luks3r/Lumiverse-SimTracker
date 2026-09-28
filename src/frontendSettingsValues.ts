import { DEFAULT_CONFIG, FERTILITY_CYCLE_BIAS_VALUES, type FertilityCycleBias, type TrackerConfig } from "./trackerConfig";
import { sanitizeIdentifier, sanitizeTagName } from "./trackerSyntax";

export type FrontendSettingsValues = {
  selectedTemplate?: string;
  tag?: string;
  identifier?: string;
  hide?: boolean;
  inline?: boolean;
  format?: string;
  retain?: string;
  llmEnable?: boolean;
  llmConnection?: string;
  llmModel?: unknown;
  llmMsgCount?: string;
  llmTemp?: string;
  llmStrip?: boolean;
  cycleBias?: string;
  tsEnable?: boolean;
  tsKey?: string;
  tsModel?: string;
  tsQuick?: boolean;
  tsVerify?: boolean;
  tsConception?: boolean;
  tsConfidence?: string;
};

function sanitizeRetainCount(value: string): number {
  const num = Number(value);
  if (Number.isNaN(num)) return 3;
  return Math.max(0, Math.min(20, Math.floor(num)));
}

const SECONDARY_LLM_MODEL_PLACEHOLDERS = new Set(["", "string", "model", "your-model-here", "null", "undefined"]);

function sanitizeSecondaryLLMModel(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return SECONDARY_LLM_MODEL_PLACEHOLDERS.has(trimmed.toLowerCase()) ? "" : trimmed;
}

export function buildSavedFrontendConfig(
  config: TrackerConfig,
  values: FrontendSettingsValues,
  fallbackId: unknown,
): TrackerConfig {
  return {
    ...config,
    templateId: values.selectedTemplate || DEFAULT_CONFIG.templateId,
    trackerTagName: sanitizeTagName(values.tag || "tracker"),
    codeBlockIdentifier: sanitizeIdentifier(values.identifier || fallbackId || "sim"),
    hideSimBlocks: Boolean(values.hide),
    enableInlineTemplates: Boolean(values.inline),
    trackerFormat: values.format === "yaml" ? "yaml" : "json",
    retainTrackerCount: sanitizeRetainCount(values.retain || "3"),
    useSecondaryLLM: Boolean(values.llmEnable),
    secondaryLLMConnectionId: values.llmConnection || "",
    secondaryLLMModel: sanitizeSecondaryLLMModel(values.llmModel ?? ""),
    secondaryLLMMessageCount: Math.max(1, Math.min(50, Math.floor(Number(values.llmMsgCount) || 5))),
    secondaryLLMTemperature: Math.max(0, Math.min(2, Number(values.llmTemp) || 0.7)),
    secondaryLLMStripHTML: Boolean(values.llmStrip),
    fertilityCycleBias: (FERTILITY_CYCLE_BIAS_VALUES as readonly string[]).includes(values.cycleBias || "")
      ? (values.cycleBias as FertilityCycleBias)
      : DEFAULT_CONFIG.fertilityCycleBias,
    typeSafeEnabled: Boolean(values.tsEnable),
    typeSafeApiKey: (values.tsKey || "").trim(),
    typeSafeModel: (values.tsModel || "").trim() || DEFAULT_CONFIG.typeSafeModel,
    typeSafeQuickAppend: Boolean(values.tsQuick),
    typeSafeVerify: Boolean(values.tsVerify),
    typeSafeConception: Boolean(values.tsConception),
    typeSafeConfidenceFloor: Math.min(0.95, Math.max(0.3, Number(values.tsConfidence) || DEFAULT_CONFIG.typeSafeConfidenceFloor)),
  };
}
