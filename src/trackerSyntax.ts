import { DEFAULT_CONFIG } from "./trackerConfig";

export function sanitizeIdentifier(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CONFIG.codeBlockIdentifier;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return DEFAULT_CONFIG.codeBlockIdentifier;
  return trimmed.replace(/[^a-z0-9_-]/g, "") || DEFAULT_CONFIG.codeBlockIdentifier;
}

export function sanitizeTagName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_CONFIG.trackerTagName;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return DEFAULT_CONFIG.trackerTagName;
  return trimmed.replace(/[^a-z0-9_-]/g, "") || DEFAULT_CONFIG.trackerTagName;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildTrackerFenceRegex(identifier: string, flags = "i"): RegExp {
  const cleanIdentifier = sanitizeIdentifier(identifier);
  const escapedIdentifier = escapeRegex(cleanIdentifier);
  return new RegExp(
    String.raw`\`\`\`[ \t]*${escapedIdentifier}(?=[ \t\r\n]|$)[^\n\r]*\r?\n([\s\S]*?)\r?\n?\s*\`\`\``,
    flags,
  );
}

export function parseTagAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const key = match[1] || "";
    if (!key) continue;
    out[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return out;
}

export function buildTrackerTagRegex(tagName: string, flags = "i"): RegExp {
  const safeTag = escapeRegex(sanitizeTagName(tagName));
  return new RegExp(String.raw`<${safeTag}\b([^>]*)>([\s\S]*?)<\/${safeTag}>`, flags);
}

export function extractSimBlock(message: string, identifier: string): string | null {
  const re = buildTrackerFenceRegex(identifier, "i");
  const match = message.match(re);
  if (!match) return null;
  return match[1]?.trim() || null;
}

export function extractTrackerTag(message: string, tagName: string, identifier: string): string | null {
  const re = buildTrackerTagRegex(tagName, "ig");
  const cleanIdentifier = sanitizeIdentifier(identifier);
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    const attrs = parseTagAttributes(match[1] || "");
    const typeAttr = sanitizeIdentifier(attrs.type || "");
    if (typeAttr && typeAttr !== cleanIdentifier) continue;
    return (match[2] || "").trim() || null;
  }
  return null;
}

export function extractTrackerTagLoose(message: string, tagName: string): string | null {
  const re = buildTrackerTagRegex(tagName, "ig");
  const match = re.exec(message);
  return match ? (match[2] || "").trim() || null : null;
}
