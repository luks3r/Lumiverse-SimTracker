import type { TemplatePreset } from "./templatePresets";
import type { FertilityCycleBias } from "./fertilityCycleHint";
export type { FertilityCycleBias } from "./fertilityCycleHint";

export const FERTILITY_CYCLE_BIAS_VALUES: readonly FertilityCycleBias[] = [
  "random",
  "menstruating",
  "start_follicular",
  "close_ovulation",
  "ovulating",
  "start_luteal",
  "end_luteal",
];

export type TrackerConfig = {
  trackerTagName: string;
  codeBlockIdentifier: string;
  hideSimBlocks: boolean;
  templateId: string;
  trackerFormat: "json" | "yaml";
  retainTrackerCount: number;
  enableInlineTemplates: boolean;
  userPresets: TemplatePreset[];
  inlinePacks: Array<Record<string, unknown>>;
  useSecondaryLLM: boolean;
  secondaryLLMConnectionId: string;
  secondaryLLMModel: string;
  secondaryLLMMessageCount: number;
  secondaryLLMTemperature: number;
  secondaryLLMStripHTML: boolean;
  fertilityCycleBias: FertilityCycleBias;
  typeSafeEnabled: boolean;
  typeSafeApiKey: string;
  typeSafeModel: string;
  typeSafeQuickAppend: boolean;
  typeSafeVerify: boolean;
  typeSafeConception: boolean;
  typeSafeConfidenceFloor: number;
};

export const DEFAULT_CONFIG: TrackerConfig = {
  trackerTagName: "tracker",
  codeBlockIdentifier: "sim",
  hideSimBlocks: true,
  templateId: "bento-style-tracker",
  trackerFormat: "json",
  retainTrackerCount: 3,
  enableInlineTemplates: false,
  userPresets: [],
  inlinePacks: [],
  useSecondaryLLM: false,
  secondaryLLMConnectionId: "",
  secondaryLLMModel: "",
  secondaryLLMMessageCount: 5,
  secondaryLLMTemperature: 0.7,
  secondaryLLMStripHTML: true,
  fertilityCycleBias: "random",
  typeSafeEnabled: false,
  typeSafeApiKey: "",
  typeSafeModel: "jev-latest",
  typeSafeQuickAppend: true,
  typeSafeVerify: true,
  typeSafeConception: true,
  typeSafeConfidenceFloor: 0.6,
};
