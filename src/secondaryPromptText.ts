import { escapeRegex, sanitizeIdentifier, sanitizeTagName } from "./trackerSyntax";

/** Convert old code-fence examples to the tracker tag used on the wire. */
export function sanitizeSysPromptForWireFormat(base: string, tagName: string, identifier: string): string {
  if (!base) return base;
  const safeTag = sanitizeTagName(tagName);
  const safeId = sanitizeIdentifier(identifier);
  const idEsc = escapeRegex(safeId);
  const wrap = (body: string) => `<${safeTag} type="${safeId}">\n${body.trim()}\n</${safeTag}>`;

  const idFenceRe = new RegExp(
    String.raw`\`\`\`[ \t]*${idEsc}\b[^\n]*\r?\n([\s\S]*?)\r?\n?[ \t]*\`\`\``,
    "gi",
  );
  let out = base.replace(idFenceRe, (_m, body: string) => wrap(body));

  const dataFenceRe = /```[ \t]*(?:json|yaml|yml)\b[^\n]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/gi;
  out = out.replace(dataFenceRe, (match, body: string) => {
    const looksLikeTracker = /\bworldData\b|\bcharacters?\b|"name"\s*:/.test(body);
    return looksLikeTracker ? wrap(body) : match;
  });

  const textRe = new RegExp(
    String.raw`\`?${idEsc}\`?[ \t]*code[ \t-]*block(?:s)?`,
    "gi",
  );
  out = out.replace(textRe, `${safeTag} tag`);

  return out;
}

export function stripStructuralHTML(text: string): string {
  if (!text) return text;
  const tagsToRemove = [
    "div", "details", "summary", "section", "article", "aside", "nav",
    "header", "footer", "main", "figure", "figcaption", "blockquote",
    "pre", "code", "script", "style", "iframe", "object", "embed",
  ];
  let stripped = text;
  for (const tag of tagsToRemove) {
    stripped = stripped.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
    stripped = stripped.replace(new RegExp(`<${tag}[^>]*\\/>`, "gi"), "");
  }
  return stripped.replace(/\s+/g, " ").trim();
}
