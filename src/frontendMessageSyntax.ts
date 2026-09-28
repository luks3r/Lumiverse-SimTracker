function sanitizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "sim";
}

function sanitizeTagName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "tracker";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTagAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(raw)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    out[key] = value;
  }
  return out;
}

export function createFrontendMessageSyntax(readTagName: () => string) {
  function extractTrackerBlock(content: string, identifier: string): string | null {
    const tagName = sanitizeTagName(readTagName() || "tracker");
    const tagRe = new RegExp(String.raw`<${escapeRegex(tagName)}\b([^>]*)>([\s\S]*?)<\/${escapeRegex(tagName)}>` , "ig");
    const cleanIdentifier = sanitizeIdentifier(identifier);
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRe.exec(content)) !== null) {
      const attrsRaw = tagMatch[1] || "";
      const attrs = parseTagAttrs(attrsRaw);
      const foundType = sanitizeIdentifier(attrs.type || "");
      if (foundType && foundType !== cleanIdentifier) continue;
      return tagMatch[2]?.trim() || null;
    }

    if (!cleanIdentifier) return null;
    const id = escapeRegex(cleanIdentifier);
    const re = new RegExp(String.raw`(?:^|\n)\s*\`\`\`[ \t]*${id}(?=[ \t\r\n]|$)[^\n\r]*\r?\n([\s\S]*?)\r?\n?\s*\`\`\``, "i");
    return content.match(re)?.[1]?.trim() || null;
  }

  return { extractTrackerBlock };
}

export function readMessageContext(payload: unknown): { content: string | null; messageId: string | null; isUser: boolean | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const messageIdCandidate = typeof value.messageId === "string" ? value.messageId : typeof value.message_id === "string" ? value.message_id : null;
  if (typeof value.content === "string") {
    return {
      content: value.content,
      messageId: messageIdCandidate,
      isUser: typeof value.is_user === "boolean" ? value.is_user : null,
    };
  }
  const nested = value.message as Record<string, unknown> | undefined;
  return {
    content: typeof nested?.content === "string" ? nested.content : null,
    messageId:
      typeof nested?.id === "string"
        ? nested.id
        : typeof nested?.messageId === "string"
          ? nested.messageId
          : messageIdCandidate,
    isUser: typeof nested?.is_user === "boolean" ? nested.is_user : null,
  };
}
