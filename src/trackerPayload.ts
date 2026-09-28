import { parse as parseYaml } from "yaml";

export function parseTrackerPayload(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/([\s:[,{])\+(\d+(?:\.\d+)?)([\s,}\]\n\r]|$)/g, "$1$2$3");
  if (!cleaned) return null;
  try {
    const json = JSON.parse(cleaned) as unknown;
    if (json && typeof json === "object") return json as Record<string, unknown>;
  } catch {
    // Try YAML next.
  }
  try {
    const yaml = parseYaml(cleaned) as unknown;
    if (yaml && typeof yaml === "object") return yaml as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

export function parseGeneratedTrackerPayload(raw: string): Record<string, unknown> | null {
  const sanitized = raw.trim()
    .replace(/^```(?:json|yaml|yml)\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  return parseTrackerPayload(sanitized);
}

/**
 * Render tracker data as a compact Markdown tree for prompt context. Tracker
 * payloads remain JSON/YAML everywhere they need to be parsed or persisted;
 * this representation is only used at the point where data enters an LLM
 * prompt or macro.
 */
export function formatTrackerForPrompt(raw: string): string {
  const parsed = parseTrackerPayload(raw);
  if (!parsed) return raw.trim();

  const lines: string[] = [];
  const indent = (depth: number) => "  ".repeat(depth);
  const scalar = (value: unknown): string => {
    if (value === null) return "null";
    if (typeof value === "string") {
      const compact = value.replace(/\s*\r?\n\s*/g, " / ").trim();
      return compact || "(empty)";
    }
    return String(value);
  };

  const appendValue = (key: string, value: unknown, depth: number): void => {
    const prefix = `${indent(depth)}- ${key}:`;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${prefix} (none)`);
        return;
      }
      if (value.every((item) => item === null || typeof item !== "object")) {
        lines.push(`${prefix} ${value.map(scalar).join(", ")}`);
        return;
      }
      lines.push(prefix);
      value.forEach((item, index) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item as Record<string, unknown>);
          if (entries.length === 0) {
            lines.push(`${indent(depth + 1)}- Item ${index + 1}: (empty)`);
            return;
          }
          const preferredIndex = entries.findIndex(([entryKey, entryValue]) =>
            entryKey === "name" && (entryValue === null || typeof entryValue !== "object")
          );
          const firstIndex = preferredIndex >= 0 ? preferredIndex : 0;
          const [firstKey, firstValue] = entries[firstIndex];
          const remainingEntries = entries.filter((_, entryIndex) => entryIndex !== firstIndex);
          if (firstValue === null || typeof firstValue !== "object") {
            lines.push(`${indent(depth + 1)}- ${firstKey}: ${scalar(firstValue)}`);
          } else {
            lines.push(`${indent(depth + 1)}- Item ${index + 1}:`);
            appendValue(firstKey, firstValue, depth + 2);
          }
          remainingEntries.forEach(([childKey, childValue]) => {
            appendValue(childKey, childValue, depth + 2);
          });
          return;
        }
        appendValue(`Item ${index + 1}`, item, depth + 1);
      });
      return;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        lines.push(`${prefix} (empty)`);
        return;
      }
      lines.push(prefix);
      entries.forEach(([childKey, childValue]) => appendValue(childKey, childValue, depth + 1));
      return;
    }
    lines.push(`${prefix} ${scalar(value)}`);
  };

  const entries = Object.entries(parsed);
  if (entries.length === 0) return "- Tracker: (none yet)";
  entries.forEach(([key, value]) => appendValue(key, value, 0));
  return lines.join("\n");
}
