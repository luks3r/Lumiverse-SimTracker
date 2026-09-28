import { getTemplatePresetById, type TemplatePreset } from "./templatePresets";

function upgradeLegacyImportedPreset(preset: TemplatePreset): TemplatePreset {
  const html = preset.htmlTemplate || "";
  const isMissingAttire = !html.includes("nw-attire");
  const bundled = getTemplatePresetById("narrative-weave-simtracker");
  const bundledRevision = Number(bundled.extSettings?.presetRevision) || 0;
  const importedRevision = Number(preset.extSettings?.presetRevision) || 0;
  const isOutdatedRevision = importedRevision < bundledRevision;
  const isLegacyNarrativeWeave =
    preset.templateName === "Narrative Weave SimTracker"
    && html.includes("nw-turn-updates")
    && html.includes("nw-delta-segment")
    && (!html.includes("nw-stat-numbers") || isMissingAttire || isOutdatedRevision);

  if (!isLegacyNarrativeWeave) return preset;

  // Imported Narrative Weave copies receive timestamp IDs, so selecting one
  // bypasses bundled updates. Upgrade only copies with known template markers.
  return {
    ...preset,
    htmlTemplate: bundled.htmlTemplate || preset.htmlTemplate,
    ...(isMissingAttire || isOutdatedRevision
      ? {
          sysPrompt: bundled.sysPrompt || preset.sysPrompt,
          displayInstructions: bundled.displayInstructions || preset.displayInstructions,
          inlineTemplatesEnabled: bundled.inlineTemplatesEnabled ?? preset.inlineTemplatesEnabled,
          inlineTemplates: bundled.inlineTemplates || preset.inlineTemplates,
          customFields: bundled.customFields || preset.customFields,
          extSettings: bundled.extSettings || preset.extSettings,
        }
      : {}),
  };
}

export function sanitizePresetArray(value: unknown): TemplatePreset[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => {
      const p = item as Record<string, unknown>;
      return upgradeLegacyImportedPreset({
        id: typeof p.id === "string" && p.id ? p.id : `user-preset-${idx}`,
        templateName: typeof p.templateName === "string" ? p.templateName : `User Preset ${idx + 1}`,
        templateAuthor: typeof p.templateAuthor === "string" ? p.templateAuthor : "User",
        htmlTemplate: typeof p.htmlTemplate === "string" ? p.htmlTemplate : "",
        sysPrompt: typeof p.sysPrompt === "string" ? p.sysPrompt : "",
        displayInstructions: typeof p.displayInstructions === "string" ? p.displayInstructions : "",
        inlineTemplatesEnabled: typeof p.inlineTemplatesEnabled === "boolean" ? p.inlineTemplatesEnabled : false,
        inlineTemplates: Array.isArray(p.inlineTemplates) ? p.inlineTemplates : [],
        customFields: Array.isArray(p.customFields) ? (p.customFields as any) : [],
        extSettings: (p.extSettings && typeof p.extSettings === "object" ? p.extSettings : {}) as Record<string, unknown>,
      });
    });
}

export function sanitizeSinglePreset(value: unknown, fallbackId: string): TemplatePreset | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  return {
    id: typeof p.id === "string" && p.id ? p.id : fallbackId,
    templateName: typeof p.templateName === "string" && p.templateName ? p.templateName : fallbackId,
    templateAuthor: typeof p.templateAuthor === "string" ? p.templateAuthor : "Seeded",
    htmlTemplate: typeof p.htmlTemplate === "string" ? p.htmlTemplate : "",
    sysPrompt: typeof p.sysPrompt === "string" ? p.sysPrompt : "",
    displayInstructions: typeof p.displayInstructions === "string" ? p.displayInstructions : "",
    inlineTemplatesEnabled: typeof p.inlineTemplatesEnabled === "boolean" ? p.inlineTemplatesEnabled : false,
    inlineTemplates: Array.isArray(p.inlineTemplates) ? p.inlineTemplates : [],
    customFields: Array.isArray(p.customFields)
      ? (p.customFields as Array<{ key: string; description: string }>)
      : [],
    extSettings: (p.extSettings && typeof p.extSettings === "object" ? p.extSettings : {}) as Record<string, unknown>,
  };
}

export function sanitizeInlinePacks(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
}
