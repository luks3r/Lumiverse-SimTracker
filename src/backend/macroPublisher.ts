import type { SpindleAPI } from "lumiverse-spindle-types";
import type { TrackerConfig } from "../shared/trackerConfig";
import type { TemplatePreset } from "../shared/templatePresets";
import { buildTemplateExampleData as buildTemplateExampleDataForPreset, formatTrackerPayload as formatTrackerPayloadWithTag } from "./trackerCommandText";
import { sanitizeIdentifier, sanitizeTagName } from "../shared/trackerSyntax";
import { sanitizeSysPromptForWireFormat } from "./secondaryPromptText";

export function createMacroPublisher(deps: {
  spindle: SpindleAPI;
  readConfig: () => TrackerConfig;
  getActivePreset: () => TemplatePreset;
  readFirstMessageFertilityHint: () => string;
  publishSelectedTracker: () => void;
}) {
  const { spindle } = deps;
function buildTemplateExampleData(): Record<string, unknown> {
  return buildTemplateExampleDataForPreset(deps.getActivePreset());
}

function buildExampleTrackerBlock(format: "json" | "yaml", identifier: string): string {
  const data = buildTemplateExampleData();
  return formatTrackerPayload(data, format, identifier);
}

function formatTrackerPayload(data: Record<string, unknown>, format: "json" | "yaml", identifier: string): string {
  return formatTrackerPayloadWithTag(data, format, identifier, deps.readConfig().trackerTagName);
}

function registerMacros(): void {
spindle.registerMacro({
  name: "sim_format",
  category: "extension:silly_sim_tracker",
  description: "Example tracker tag format",
  returnType: "string",
  handler: "",
});

spindle.registerMacro({
  name: "sim_tracker",
  category: "extension:silly_sim_tracker",
  description: "Main tracker instructions for the active template",
  returnType: "string",
  handler: "",
});

spindle.registerMacro({
  name: "last_sim_stats",
  category: "extension:silly_sim_tracker",
  description: "The latest tracker state as a compact Markdown list",
  returnType: "string",
  handler: "",
});

}

/**
 * Rewrite any instructions in the preset's sysPrompt that would lead the
 * LLM to emit a markdown code fence (e.g. ```sim ... ```) for tracker
 * data. The frontend's MESSAGE_TAG_INTERCEPTED path only fires on the
 * configured XML tag, so a fenced block silently bypasses tracker
 * capture, side-channel history, and secondary-LLM plumbing.
 *
 * Three passes, each targeting a different way the fence format leaks in:
 *   1. `\`\`\`<identifier> ... \`\`\`` fences — authors copy/paste these
 *      as literal examples. Rewritten as the XML wrapper so the example
 *      still shows the intended shape but in the correct format.
 *   2. `\`\`\`json` / `\`\`\`yaml` fences whose body looks like a tracker
 *      payload (references `worldData` / `characters` / a `"name"` key).
 *      Non-tracker code examples are left alone.
 *   3. Textual references like ``\`sim\` codeblock``, `Sim codeblock`,
 *      `DISP code block` — replaced with the tracker-tag terminology.
 */
/**
 * Push current macro values to the host so prompt assembly can resolve
 * them instantly without an RPC roundtrip to the worker.
 */
function pushMacroValues(): void {
  // sim_format
  const fmt = buildExampleTrackerBlock(deps.readConfig().trackerFormat, deps.readConfig().codeBlockIdentifier);
  spindle.updateMacroValue("sim_format", fmt);

  // sim_tracker — always resolve the *active* preset (built-in, seeded,
  // or user-imported) so switching the template dropdown actually swaps
  // the prompt the LLM sees. A static id→prompt map here previously
  // ignored anything outside the bundled defaults.
  const tag = sanitizeTagName(deps.readConfig().trackerTagName);
  const id = sanitizeIdentifier(deps.readConfig().codeBlockIdentifier);
  const rawBase = deps.getActivePreset().sysPrompt || "";
  const base = sanitizeSysPromptForWireFormat(rawBase, tag, id);
  const directive = [
    "IMPORTANT OUTPUT FORMAT:",
    "Do not emit markdown code fences for tracker data.",
    "Emit a single XML block using this exact wrapper:",
    `<${tag} type="${id}">`,
    "{...tracker JSON or YAML...}",
    `</${tag}>`,
    "Narrative text must remain outside the tracker tag.",
  ].join("\n");
  let simTracker = base
    ? directive + "\n\n" + base.replace(/\{\{sim_format\}\}/g, fmt)
    : directive + "\n\n" + fmt;
  if (deps.readFirstMessageFertilityHint()) {
    simTracker += "\n\n" + deps.readFirstMessageFertilityHint();
  }
  spindle.updateMacroValue("sim_tracker", simTracker);

  // last_sim_stats is scoped to the selected chat, not the last event observed.
  deps.publishSelectedTracker();
}
  return { registerMacros, pushMacroValues, buildExampleTrackerBlock, formatTrackerPayload };
}
