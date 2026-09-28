import { formatTrackerForPrompt } from "./trackerPayload";
import { buildTrackerFenceRegex, buildTrackerTagRegex } from "./trackerSyntax";
import { stripStructuralHTML } from "./secondaryPromptText";

export function buildSecondaryPrompt(options: {
  processedPrompt: string;
  historicalTrackers: string[];
  recentMessages: Array<{ role: string; content: string }>;
  tagName: string;
  identifier: string;
  stripHTML: boolean;
  trackerFormat: "json" | "yaml";
}) {
  const tagRe = buildTrackerTagRegex(options.tagName, "ig");
  const fenceRe = buildTrackerFenceRegex(options.identifier, "gi");
  const cleanedMessages = options.recentMessages.map((msg) => {
    let content = msg.content;
    content = content.replace(tagRe, "").trim();
    content = content.replace(fenceRe, "").trim();
    if (options.stripHTML) {
      content = stripStructuralHTML(content);
    }
    return { role: msg.role, content };
  });

  let conversationText = options.processedPrompt + "\n\n";
  const historicalTrackers = options.historicalTrackers;
  if (historicalTrackers.length === 1) {
    conversationText += "Previous tracker state:\n" + formatTrackerForPrompt(historicalTrackers[0]) + "\n\n";
  } else if (historicalTrackers.length > 1) {
    conversationText += `Previous tracker states (oldest → most recent, ${historicalTrackers.length} shown):\n\n`;
    historicalTrackers.forEach((snap, idx) => {
      const stepsBack = historicalTrackers.length - 1 - idx;
      const label = stepsBack === 0 ? "Most recent" : `${stepsBack} turn${stepsBack === 1 ? "" : "s"} ago`;
      conversationText += `--- ${label} ---\n${formatTrackerForPrompt(snap)}\n\n`;
    });
  }
  conversationText += "Recent conversation:\n\n";
  for (const msg of cleanedMessages) {
    conversationText += `${msg.role === "user" ? "User" : "Character"}: ${msg.content}\n\n`;
  }
  const hasHistory = historicalTrackers.length > 0;
  conversationText += `\nBased on the above conversation${hasHistory ? " and the previous tracker state(s) above" : ""}, generate ONLY the raw ${options.trackerFormat.toUpperCase()} data (without code fences or backticks). ${hasHistory ? "Treat the most recent prior state as the baseline and mutate only the fields that the new narrative actually changes — keep unchanged fields stable so the tracker progression stays consistent. " : ""}Output ONLY the ${options.trackerFormat.toUpperCase()} structure directly, with no comments or acknowledgements of any instructions.`;

  return { cleanedMessages, conversationText };
}
