import type { SpindleAPI } from "lumiverse-spindle-types";

const CHARACTER_CONTEXT = [
  "Character-card context (initialization only):",
  "Name: {{char}}",
  "Description: {{description}}",
  "Personality: {{personality}}",
  "Scenario: {{scenario}}",
].join("\n");

const BASELINE_POLICY = "Stable baseline traits already present in the previous tracker are authoritative. Do not re-infer or re-randomize them unless new narrative evidence contradicts them. When character-card context is provided, use it only to initialize missing stable traits, not as current scene state.";
const FORCED_CONTEXT_POLICY = "This is a manual character-card refresh. Use the character-card context to update stable traits that conflict with the previous tracker. Preserve unrelated tracker values, and derive current scene state from the recent narrative.";

export async function resolveSecondaryPresetPrompt(options: {
  spindle: Pick<SpindleAPI, "macros">;
  chatId: string;
  sysPrompt: string;
  formatExample: string;
  hasKnownPriorTracker: boolean;
  forceCharacterContext?: boolean;
}): Promise<string> {
  const includeContext = options.forceCharacterContext || !options.hasKnownPriorTracker;
  const context = options.forceCharacterContext
    ? CHARACTER_CONTEXT.replace("initialization only", "manual refresh")
    : CHARACTER_CONTEXT;
  const hasContextMarker = options.sysPrompt.includes("{{sim_character_context}}");
  const template = (options.forceCharacterContext && !hasContextMarker
    ? `${options.sysPrompt}\n\n${context}`
    : options.sysPrompt)
    .replace(/\{\{sim_character_context\}\}/g, includeContext ? context : "")
    .replace(/\{\{sim_format\}\}/g, options.formatExample)
    .replace(/\{\{charDescription\}\}/g, "{{description}}")
    .replace(/\{\{charPersonality\}\}/g, "{{personality}}")
    .replace(/\{\{charScenario\}\}/g, "{{scenario}}");
  const { text } = await options.spindle.macros.resolve(template, { chatId: options.chatId, commit: false });
  return `${text}\n\n${options.forceCharacterContext ? FORCED_CONTEXT_POLICY : BASELINE_POLICY}`;
}
