export function collectSecondaryHistory(options: {
  retainTrackerCount: number;
  targetMessageId: string;
  messages: Array<{ id: string; role: string; content: string }>;
  getRecentPayloads: (limit: number, excludeMessageId: string) => string[];
  extractTrackerPayloadFromMessage: (content: string) => string | null;
}): string[] {
  // Honour Retain N exactly: zero excludes history, positive values cap at ten.
  const retainSetting = Number.isFinite(options.retainTrackerCount) ? options.retainTrackerCount : 3;
  const historyLimit = Math.max(0, Math.min(10, retainSetting));
  let historicalTrackers = historyLimit === 0
    ? []
    : options.getRecentPayloads(historyLimit, options.targetMessageId);

  if (historyLimit > 0 && historicalTrackers.length === 0) {
    // Fallback to chat content when the side-channel missed older tags.
    const nonSystem = options.messages.filter((m) => m.role !== "system");
    const targetIdx = nonSystem.findIndex((m) => m.id === options.targetMessageId);
    const scanEnd = targetIdx >= 0 ? targetIdx : nonSystem.length;
    const found: string[] = [];
    for (let i = scanEnd - 1; i >= 0 && found.length < historyLimit; i -= 1) {
      const payload = options.extractTrackerPayloadFromMessage(nonSystem[i].content);
      if (payload) found.unshift(payload);
    }
    historicalTrackers = found;
  }

  return historicalTrackers;
}
