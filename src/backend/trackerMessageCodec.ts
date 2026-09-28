import { DEFAULT_CONFIG, type TrackerConfig } from "../shared/trackerConfig";
import { parseTrackerPayload } from "./trackerPayload";
import { extractSimBlock, extractTrackerTag, extractTrackerTagLoose, sanitizeIdentifier, sanitizeTagName } from "../shared/trackerSyntax";

export function createTrackerMessageCodec(readConfig: () => Pick<TrackerConfig, "trackerTagName" | "codeBlockIdentifier">) {
  const config = {
    get trackerTagName() { return readConfig().trackerTagName; },
    get codeBlockIdentifier() { return readConfig().codeBlockIdentifier; },
  };

  function buildCanonicalTrackerTag(payload: string, identifier: string): string {
    const tagName = sanitizeTagName(config.trackerTagName);
    const safeIdentifier = sanitizeIdentifier(identifier);
    return `<${tagName} type="${safeIdentifier}">\n${payload.trim()}\n</${tagName}>`;
  }
  
  function extractAnyTrackerFencePayload(message: string): string | null {
    const fenceRe = /```[ \t]*([a-z0-9_-]+)(?=[ \t\r\n]|$)[^\n\r]*\r?\n([\s\S]*?)\r?\n?\s*```/gi;
    let match: RegExpExecArray | null;
    while ((match = fenceRe.exec(message)) !== null) {
      const payload = (match[2] || "").trim();
      if (!payload) continue;
      const directTagPayload = extractTrackerTagLoose(payload, config.trackerTagName);
      if (directTagPayload) return directTagPayload;
      const parsed = parseTrackerPayload(payload);
      if (parsed) return payload;
    }
    return null;
  }
  
  function legacyHiddenDivTrackerRanges(message: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const divRe = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
    let match: RegExpExecArray | null;
    while ((match = divRe.exec(message)) !== null) {
      const attrs = match[1] || "";
      const inner = match[2] || "";
      const full = match[0] || "";
      if (typeof match.index !== "number" || !full) continue;
      if (!/style\s*=\s*(?:"[^"]*display\s*:\s*none\s*;?[^"]*"|'[^']*display\s*:\s*none\s*;?[^']*')/i.test(attrs)) {
        continue;
      }
      if (!extractLegacyHiddenDivNormalizedPayload(inner, config.codeBlockIdentifier)) continue;
      ranges.push({ start: match.index, end: match.index + full.length });
    }
    return ranges;
  }
  
  function extractLegacyHiddenDivNormalizedPayload(inner: string, identifier: string): string | null {
    const directTagPayload = extractTrackerTagLoose(inner, config.trackerTagName);
    if (directTagPayload) return directTagPayload;
  
    const fencedPayload = extractSimBlock(inner, identifier)
      || (identifier !== DEFAULT_CONFIG.codeBlockIdentifier
        ? extractSimBlock(inner, DEFAULT_CONFIG.codeBlockIdentifier)
        : null)
      || extractAnyTrackerFencePayload(inner);
    if (!fencedPayload) return null;
  
    return extractTrackerTagLoose(fencedPayload, config.trackerTagName) || fencedPayload.trim() || null;
  }
  
  function extractLegacyHiddenDivTrackerPayload(message: string): string | null {
    const divRe = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
    let match: RegExpExecArray | null;
    while ((match = divRe.exec(message)) !== null) {
      const attrs = match[1] || "";
      const inner = match[2] || "";
      if (!/style\s*=\s*(?:"[^"]*display\s*:\s*none\s*;?[^"]*"|'[^']*display\s*:\s*none\s*;?[^']*')/i.test(attrs)) {
        continue;
      }
      const payload = extractLegacyHiddenDivNormalizedPayload(inner, config.codeBlockIdentifier);
      if (payload) return payload;
    }
    return null;
  }
  
  function extractTrackerPayloadFromMessage(message: string): string | null {
    return (
      extractTrackerTag(message, config.trackerTagName, config.codeBlockIdentifier) ||
      extractSimBlock(message, config.codeBlockIdentifier) ||
      extractLegacyHiddenDivTrackerPayload(message)
    );
  }
  
  function normalizeLegacyHiddenDivTrackers(message: string): { content: string; replacements: number } {
    if (!message) return { content: message, replacements: 0 };
  
    const identifier = sanitizeIdentifier(config.codeBlockIdentifier);
    const divRe = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
    let replacements = 0;
  
    const content = message.replace(divRe, (full, rawAttrs, rawInner) => {
      const attrs = typeof rawAttrs === "string" ? rawAttrs : "";
      const inner = typeof rawInner === "string" ? rawInner : "";
      if (!/style\s*=\s*(?:"[^"]*display\s*:\s*none\s*;?[^"]*"|'[^']*display\s*:\s*none\s*;?[^']*')/i.test(attrs)) {
        return full;
      }
  
      const payload = extractLegacyHiddenDivNormalizedPayload(inner, identifier);
      if (!payload) return full;
  
      replacements += 1;
      return buildCanonicalTrackerTag(payload, identifier);
    });
  
    return { content, replacements };
  }

  return { extractTrackerPayloadFromMessage, normalizeLegacyHiddenDivTrackers, legacyHiddenDivTrackerRanges, extractLegacyHiddenDivNormalizedPayload };
}
