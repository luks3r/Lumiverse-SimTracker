import { stringify as stringifyYaml } from "yaml";
import { inferExampleValue, setDeep } from "./trackerExample";
import type { TemplatePreset } from "../shared/templatePresets";
import { buildTrackerFenceRegex, buildTrackerTagRegex, parseTagAttributes, sanitizeIdentifier, sanitizeTagName } from "../shared/trackerSyntax";

export function buildTemplateExampleData(preset: TemplatePreset): Record<string, unknown> {
  const fields = Array.isArray(preset.customFields) ? preset.customFields : [];
  const worldData: Record<string, unknown> = {
    current_date: "YYYY-MM-DD",
    current_time: "HH:MM",
  };
  const character: Record<string, unknown> = {
    name: "Character Name",
  };

  for (const field of fields) {
    const key = typeof field?.key === "string" ? field.key.trim() : "";
    if (!key) continue;
    const description = typeof field?.description === "string" ? field.description : "";
    const sample = inferExampleValue(key, description);

    if (key.startsWith("worldData.")) {
      setDeep(worldData, key.slice("worldData.".length), sample);
      continue;
    }
    const normalizedKey = key.replace(/^character\./i, "").replace(/^characters\[\]\./i, "");
    if (!normalizedKey || normalizedKey.toLowerCase() === "name") continue;
    setDeep(character, normalizedKey, sample);
  }

  return {
    worldData,
    characters: [character],
  };
}

export function formatTrackerPayload(
  data: Record<string, unknown>,
  format: "json" | "yaml",
  identifier: string,
  tagName: string,
): string {
  const safeTagName = sanitizeTagName(tagName);
  const safeIdentifier = sanitizeIdentifier(identifier);
  const body = format === "yaml" ? stringifyYaml(data).trimEnd() : JSON.stringify(data, null, 2);
  return `<${safeTagName} type="${safeIdentifier}">\n${body}\n</${safeTagName}>`;
}

export function replaceTrackerBlock(
  content: string,
  identifier: string,
  replacementBlock: string,
  tagName: string,
): string {
  const tagRe = buildTrackerTagRegex(tagName, "ig");
  const desiredType = sanitizeIdentifier(identifier);
  let replaced = false;
  const withTag = content.replace(tagRe, (full, attrsRaw) => {
    const attrs = parseTagAttributes(String(attrsRaw || ""));
    const foundType = sanitizeIdentifier(attrs.type || "");
    if (foundType && foundType !== desiredType) return full;
    if (replaced) return full;
    replaced = true;
    return replacementBlock;
  });
  if (replaced) return withTag;

  const re = buildTrackerFenceRegex(identifier, "i");
  return withTag.replace(re, replacementBlock);
}
