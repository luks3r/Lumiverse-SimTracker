type LegacyChatMessage = {
  id: string;
  content: string;
  swipes: string[];
  swipe_id: number;
};

type NormalizedText = { content: string; replacements: number };

export function createLegacyTrackerNormalizer<T extends LegacyChatMessage>(deps: {
  getMessages: (chatId: string) => Promise<T[]>;
  updateMessage: (chatId: string, messageId: string, change: { content: string; swipes: string[]; skipChunkRebuild: true }) => Promise<unknown>;
  hasChatMutationPermission: () => boolean;
  normalizeLegacyHiddenDivTrackers: (content: string) => NormalizedText;
  logInfo: (message: string) => void;
}) {
  return async function normalizeLegacyTrackersInChat(
    chatId: string,
    scanTail = Number.MAX_SAFE_INTEGER,
  ): Promise<T[]> {
    const messages = await deps.getMessages(chatId);
    if (!deps.hasChatMutationPermission()) return messages;

    // Legacy hidden-div trackers only matter for messages that could still
    // influence current context. Cap the normalization pass to the recent tail.
    const startIdx = Math.max(0, messages.length - Math.max(0, scanTail));
    let repairedMessages = 0;
    let repairedBlocks = 0;

    for (let i = startIdx; i < messages.length; i += 1) {
      const msg = messages[i];
      const normalizedContent = deps.normalizeLegacyHiddenDivTrackers(msg.content);
      const normalizedSwipes = msg.swipes.map((swipe) => deps.normalizeLegacyHiddenDivTrackers(swipe));
      const swipesChanged = normalizedSwipes.some((entry, idx) => entry.content !== msg.swipes[idx]);
      const replacements = normalizedContent.replacements
        + normalizedSwipes.reduce((sum, entry) => sum + entry.replacements, 0);

      if (replacements === 0) continue;

      const nextSwipes = swipesChanged ? normalizedSwipes.map((entry) => entry.content) : msg.swipes;
      await deps.updateMessage(chatId, msg.id, {
        content: normalizedContent.content,
        swipes: nextSwipes,
        skipChunkRebuild: true,
      });

      msg.content = normalizedContent.content;
      msg.swipes = nextSwipes;
      if (typeof nextSwipes[msg.swipe_id] === "string") {
        msg.content = nextSwipes[msg.swipe_id] as string;
      }

      repairedMessages += 1;
      repairedBlocks += replacements;
    }

    if (repairedBlocks > 0) {
      deps.logInfo(
        `Normalized ${repairedBlocks} legacy hidden tracker block(s) across ${repairedMessages} message(s) in chat ${chatId}`,
      );
    }

    return messages;
  };
}
