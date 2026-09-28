import type { TemplatePreset } from "./templatePresets";

export function isInlinePackOnly(parsed: Record<string, unknown>): boolean {
  const hasInlineTemplates = Array.isArray(parsed.inlineTemplates) && parsed.inlineTemplates.length > 0;
  const hasTrackerTemplate =
    typeof parsed.htmlTemplate === "string"
    || typeof parsed.sysPrompt === "string"
    || Array.isArray(parsed.customFields)
    || (parsed.extSettings && typeof parsed.extSettings === "object");
  return Boolean(hasInlineTemplates && !hasTrackerTemplate);
}

export function buildImportedPreset(parsed: Record<string, unknown>, timestamp: number): TemplatePreset {
  const idBase = String(parsed.templateName || "user_preset").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return {
    id: `${idBase}_${timestamp}`,
    templateName: String(parsed.templateName || "Imported Preset"),
    templateAuthor: String(parsed.templateAuthor || "User"),
    htmlTemplate: typeof parsed.htmlTemplate === "string" ? parsed.htmlTemplate : "",
    sysPrompt: typeof parsed.sysPrompt === "string" ? parsed.sysPrompt : "",
    displayInstructions: typeof parsed.displayInstructions === "string" ? parsed.displayInstructions : "",
    inlineTemplatesEnabled: typeof parsed.inlineTemplatesEnabled === "boolean" ? parsed.inlineTemplatesEnabled : false,
    inlineTemplates: Array.isArray(parsed.inlineTemplates) ? parsed.inlineTemplates : [],
    customFields: Array.isArray(parsed.customFields)
      ? (parsed.customFields as Array<{ key: string; description: string }>)
      : [],
    extSettings: (parsed.extSettings && typeof parsed.extSettings === "object" ? parsed.extSettings : {}) as Record<string, unknown>,
  };
}
