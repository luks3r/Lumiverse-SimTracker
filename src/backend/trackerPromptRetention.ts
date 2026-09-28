import { formatTrackerForPrompt } from "./trackerPayload";
import { buildTrackerFenceRegex, buildTrackerTagRegex, parseTagAttributes, sanitizeIdentifier } from "../shared/trackerSyntax";
import type { createTrackerMessageCodec } from "./trackerMessageCodec";
import type { TrackerConfig } from "../shared/trackerConfig";
import type { LlmMessageDTO } from "lumiverse-spindle-types";

type TrackerHistoryEntry = { messageId: string; payload: string };

export function createTrackerPromptRetention(
  readConfig: () => Pick<TrackerConfig, "trackerTagName" | "codeBlockIdentifier">,
  codec: ReturnType<typeof createTrackerMessageCodec>,
) {
  const config = {
    get trackerTagName() { return readConfig().trackerTagName; },
    get codeBlockIdentifier() { return readConfig().codeBlockIdentifier; },
  };
  const { legacyHiddenDivTrackerRanges, extractLegacyHiddenDivNormalizedPayload, extractTrackerPayloadFromMessage } = codec;

  type BlockRange = { start: number; end: number };
  
  /**
   * Collect all tracker block ranges (fences, tags, legacy hidden divs) in a
   * single message, sorted by start position and deduplicated by start index.
   */
  function collectTrackerBlockRanges(content: string, identifier: string): BlockRange[] {
    if (!content) return [];
    const desiredType = sanitizeIdentifier(identifier);
    const ranges: BlockRange[] = [];
    const seenStarts = new Set<number>();
  
    const fenceRe = buildTrackerFenceRegex(identifier, "gi");
    const tagRe = buildTrackerTagRegex(config.trackerTagName, "gi");
  
    for (const match of content.matchAll(fenceRe)) {
      const text = match[0] || "";
      const start = match.index;
      if (typeof start !== "number" || !text || seenStarts.has(start)) continue;
      seenStarts.add(start);
      ranges.push({ start, end: start + text.length });
    }
    for (const match of content.matchAll(tagRe)) {
      const text = match[0] || "";
      const start = match.index;
      if (typeof start !== "number" || !text || seenStarts.has(start)) continue;
      const attrs = parseTagAttributes(match[1] || "");
      const foundType = sanitizeIdentifier(attrs.type || "");
      if (foundType && foundType !== desiredType) continue;
      seenStarts.add(start);
      ranges.push({ start, end: start + text.length });
    }
    for (const range of legacyHiddenDivTrackerRanges(content)) {
      if (seenStarts.has(range.start)) continue;
      seenStarts.add(range.start);
      ranges.push(range);
    }
  
    ranges.sort((a, b) => a.start - b.start);
    return ranges;
  }
  
  /**
   * Replace parseable tracker blocks already present in assembled messages with
   * their prompt-only Markdown representation. This complements side-channel
   * backfill: prompts are compact whether history came from canonical messages
   * or from chatTrackerHistory.
   */
  function formatTrackerBlocksInMessages<T extends { content: string | unknown[] }>(messages: T[]): T[] {
    let output: T[] | null = null;
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (!message || typeof message.content !== "string") continue;
      const ranges = collectTrackerBlockRanges(message.content, config.codeBlockIdentifier);
      if (ranges.length === 0) continue;
  
      let content = message.content;
      let changed = false;
      for (let j = ranges.length - 1; j >= 0; j -= 1) {
        const range = ranges[j];
        const block = content.slice(range.start, range.end);
        const payload = extractTrackerPayloadFromMessage(block);
        if (!payload) continue;
        const replacement = `Previous tracker state:\n${formatTrackerForPrompt(payload)}`;
        content = content.slice(0, range.start) + replacement + content.slice(range.end);
        changed = true;
      }
      if (!changed) continue;
      if (!output) output = messages.slice();
      output[i] = { ...message, content };
    }
    return output || messages;
  }
  
  /**
   * Remove every tracker block from the content. Used for messages that are
   * entirely outside the retention window.
   */
  function stripAllTrackerBlocks(content: string, identifier: string): string {
    if (!content) return content;
    const desiredType = sanitizeIdentifier(identifier);
  
    let out = content.replace(buildTrackerFenceRegex(identifier, "gi"), "");
    out = out.replace(buildTrackerTagRegex(config.trackerTagName, "gi"), (full, attrsRaw) => {
      const attrs = parseTagAttributes(String(attrsRaw || ""));
      const foundType = sanitizeIdentifier(attrs.type || "");
      if (foundType && foundType !== desiredType) return full;
      return "";
    });
    out = out.replace(/<div\b([^>]*)>([\s\S]*?)<\/div>/gi, (full, rawAttrs, rawInner) => {
      const attrs = typeof rawAttrs === "string" ? rawAttrs : "";
      const inner = typeof rawInner === "string" ? rawInner : "";
      if (!/style\s*=\s*(?:"[^"]*display\s*:\s*none\s*;?[^"]*"|'[^']*display\s*:\s*none\s*;?[^']*')/i.test(attrs)) {
        return full;
      }
      return extractLegacyHiddenDivNormalizedPayload(inner, identifier) ? "" : full;
    });
    return out.replace(/\n\s*\n\s*\n/g, "\n\n").trim();
  }
  
  /**
   * Global variant of `stripOldTrackerBlocks`: counts tracker blocks across
   * the entire message array (not per-message) and retains the `keepNewest`
   * most recent ones globally. Older blocks are removed from whichever
   * messages contained them. This matches the user-facing semantics of
   * `retainTrackerCount` — "keep the N most recent tracker snapshots in the
   * LLM context".
   *
   * Optimized to scan newest → oldest and stop as soon as `keepNewest` blocks
   * have been seen, so long chat histories are not fully parsed every turn.
   */
  function stripOldTrackerBlocksGlobal<T extends { content: string | unknown[] }>(
    messages: T[],
    identifier: string,
    keepNewest: number,
  ): T[] {
    if (keepNewest < 0) return messages;
  
    if (keepNewest === 0) {
      return messages.map((msg) => {
        if (!msg || typeof msg.content !== "string") return msg;
        return { ...msg, content: stripAllTrackerBlocks(msg.content, identifier) };
      });
    }
  
    let remaining = keepNewest;
    let cutoffMsgIdx = -1;
    let keepInCutoff = 0;
  
    // Scan newest → oldest; stop once we have seen enough trackers to satisfy
    // the retention limit.
    for (let msgIdx = messages.length - 1; msgIdx >= 0; msgIdx -= 1) {
      const msg = messages[msgIdx];
      if (!msg || typeof msg.content !== "string") continue;
      const count = countMatchingTrackerBlocksInMessage(msg.content);
      if (count === 0) continue;
      if (count >= remaining) {
        cutoffMsgIdx = msgIdx;
        keepInCutoff = remaining;
        break;
      }
      remaining -= count;
    }
  
    // No cutoff means fewer trackers than keepNewest exist — nothing to strip.
    if (cutoffMsgIdx < 0) return messages;
  
    return messages.map((msg, msgIdx) => {
      if (!msg || typeof msg.content !== "string") return msg;
      if (msgIdx > cutoffMsgIdx) return msg;
      if (msgIdx < cutoffMsgIdx) {
        return { ...msg, content: stripAllTrackerBlocks(msg.content, identifier) };
      }
  
      // Cutoff message: keep only the last `keepInCutoff` blocks.
      const ranges = collectTrackerBlockRanges(msg.content, identifier);
      if (ranges.length === 0) return msg;
      const keepStart = Math.max(0, ranges.length - keepInCutoff);
  
      let out = "";
      let cursor = 0;
      for (let i = 0; i < ranges.length; i += 1) {
        const r = ranges[i];
        out += msg.content.slice(cursor, r.start);
        if (i >= keepStart) out += msg.content.slice(r.start, r.end);
        cursor = r.end;
      }
      out += msg.content.slice(cursor);
      return { ...msg, content: out.replace(/\n\s*\n\s*\n/g, "\n\n").trim() };
    });
  }
  
  /**
   * Count how many tracker blocks (fences, tags, or legacy hidden-divs)
   * appear in a single message content string.
   */
  function countMatchingTrackerBlocksInMessage(content: string): number {
    if (!content) return 0;
    let count = 0;
  
    const fenceRe = buildTrackerFenceRegex(config.codeBlockIdentifier, "gi");
    for (const match of content.matchAll(fenceRe)) {
      if (match[0]) count++;
    }
  
    const tagRe = buildTrackerTagRegex(config.trackerTagName, "gi");
    const cleanIdentifier = sanitizeIdentifier(config.codeBlockIdentifier);
    for (const match of content.matchAll(tagRe)) {
      const attrs = parseTagAttributes(match[1] || "");
      const typeAttr = sanitizeIdentifier(attrs.type || "");
      if (typeAttr && typeAttr !== cleanIdentifier) continue;
      if (match[0]) count++;
    }
  
    count += legacyHiddenDivTrackerRanges(content).length;
  
    return count;
  }
  
  /**
   * Count tracker blocks across the message array, stopping as soon as
   * `maxNeeded` blocks are found. Since retained trackers are always near the
   * end of the context, scanning newest → oldest avoids parsing long history.
   */
  function countTrackersInMessages(
    messages: Array<{ content?: string | unknown[] }>,
    maxNeeded = Number.MAX_SAFE_INTEGER,
  ): number {
    let count = 0;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (!msg || typeof msg.content !== "string") continue;
      count += countMatchingTrackerBlocksInMessage(msg.content);
      if (count >= maxNeeded) return count;
    }
    return count;
  }
  
  /**
   * Build the prompt-only history block appended when assembled context is
   * missing tracker history. The stored payload stays parseable, but the LLM
   * receives a compact Markdown list instead of repeated JSON/YAML syntax.
   */
  function buildTrackerInjectionBlock(entries: TrackerHistoryEntry[]): string {
    if (entries.length === 1) {
      return `Previous tracker state:\n${formatTrackerForPrompt(entries[0].payload)}`;
    }
    const snapshots = entries
      .map((entry, index) => `Snapshot ${index + 1}:\n${formatTrackerForPrompt(entry.payload)}`)
      .join("\n\n");
    return `Previous tracker states (oldest → newest):\n\n${snapshots}`;
  }
  /**
   * Splice a system directive just before the final message of the prompt so
   * the LLM sees it as a trailing instruction. Returns the input array
   * unchanged when there is no directive.
   */
  function withTrailingDirective(
    messages: LlmMessageDTO[],
    directive: string,
  ): LlmMessageDTO[] {
    if (!directive) return messages;
    const injected = messages.slice();
    injected.splice(Math.max(0, injected.length - 1), 0, { role: "system", content: directive });
    return injected;
  }

  return { stripOldTrackerBlocksGlobal, formatTrackerBlocksInMessages, countTrackersInMessages, buildTrackerInjectionBlock, withTrailingDirective };
}
