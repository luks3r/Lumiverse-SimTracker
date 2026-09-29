import type { SpindleAPI } from "lumiverse-spindle-types";

const CHARACTER_CONTEXT = [
  "Character-card context (initialization only):",
  "Name: {{char}}",
  "Description: {{description}}",
  "Personality: {{personality}}",
  "Scenario: {{scenario}}",
].join("\n");

const BASELINE_POLICY = "Stable baseline traits already present in the previous tracker are authoritative. Do not re-infer or re-randomize them unless new narrative evidence contradicts them. When character-card context is provided, use it only to initialize missing stable traits, not as current scene state.";

export async function resolveSecondaryPresetPrompt(options: {
  spindle: Pick<SpindleAPI, "macros">;
  chatId: string;
  sysPrompt: string;
  formatExample: string;
  hasTrackerBaseline: boolean;
}): Promise<string> {
  const template = options.sysPrompt
    .replace(/\{\{sim_character_context\}\}/g, options.hasTrackerBaseline ? "" : CHARACTER_CONTEXT)
    .replace(/\{\{sim_format\}\}/g, options.formatExample)
    .replace(/\{\{charDescription\}\}/g, "{{description}}")
    .replace(/\{\{charPersonality\}\}/g, "{{personality}}")
    .replace(/\{\{charScenario\}\}/g, "{{scenario}}");
  const { text } = await options.spindle.macros.resolve(template, { chatId: options.chatId, commit: false });
  return `${text}\n\n${BASELINE_POLICY}`;
}
