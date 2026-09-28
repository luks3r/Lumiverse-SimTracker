import { DEFAULT_CONFIG } from "./trackerConfig";

export type TrackerHistoryEntry = { messageId: string; payload: string };

type ChatMessage = { id: string; content: string };

/**
 * Ordered per-chat tracker side-channel. The host can remove tracker tags
 * from visible messages, so observed tags also need to survive in memory.
 */
export function createTrackerHistory(deps: {
  normalizeLegacyTrackersInChat: (chatId: string, scanTail: number) => Promise<ChatMessage[]>;
  extractTrackerPayloadFromMessage: (content: string) => string | null;
  readRetainCount: () => number;
}) {
  const chatTrackerHistory = new Map<string, TrackerHistoryEntry[]>();
  const rehydratedChats = new Set<string>();

  function recordChatTracker(chatId: string | null, messageId: string | null, payload: string): void {
    if (!chatId || !messageId) return;
    const trimmed = payload.trim();
    if (!trimmed) return;
    let history = chatTrackerHistory.get(chatId);
    if (!history) {
      history = [];
      chatTrackerHistory.set(chatId, history);
    }
    const existingIdx = history.findIndex((entry) => entry.messageId === messageId);
    if (existingIdx >= 0) {
      history[existingIdx] = { messageId, payload: trimmed };
    } else {
      history.push({ messageId, payload: trimmed });
    }
  }

  function forgetChatTracker(chatId: string | null, messageId: string | null): void {
    if (!chatId || !messageId) return;
    const history = chatTrackerHistory.get(chatId);
    if (!history) return;
    const idx = history.findIndex((entry) => entry.messageId === messageId);
    if (idx >= 0) history.splice(idx, 1);
  }

  function getChatTrackerHistory(chatId: string | null): TrackerHistoryEntry[] {
    if (!chatId) return [];
    return chatTrackerHistory.get(chatId) || [];
  }

  async function rehydrateChatTrackerHistory(chatId: string | null): Promise<void> {
    if (!chatId) return;
    // Once a chat has been hydrated, MESSAGE_* subscriptions keep this
    // side-channel current. Avoid pulling and normalizing the entire chat again
    // just to answer a lightweight "latest tracker" poll on navigation.
    if (rehydratedChats.has(chatId)) return;
    try {
      // The side-channel only needs enough recent trackers to satisfy the
      // user's retention setting plus a small buffer for the side panel and
      // secondary LLM fallback. There is no need to scan the entire chat
      // history on every page reload.
      const retainCount = deps.readRetainCount();
      const retainSetting = Number.isFinite(retainCount)
        ? retainCount
        : DEFAULT_CONFIG.retainTrackerCount;
      const historyLimit = Math.max(3, Math.min(20, retainSetting + 2));
      const scanTail = Math.max(200, historyLimit * 5);

      const messages = await deps.normalizeLegacyTrackersInChat(chatId, scanTail);
      rehydratedChats.add(chatId);

      let history = chatTrackerHistory.get(chatId);
      if (!history) {
        history = [];
        chatTrackerHistory.set(chatId, history);
      }
      const known = new Set(history.map((entry) => entry.messageId));

      // Scan newest → oldest, collecting only the trackers we actually need.
      const found: TrackerHistoryEntry[] = [];
      for (let i = messages.length - 1; i >= 0 && found.length < historyLimit; i -= 1) {
        const msg = messages[i];
        if (known.has(msg.id)) continue;
        const payload = deps.extractTrackerPayloadFromMessage(msg.content);
        if (payload) {
          found.unshift({ messageId: msg.id, payload: payload.trim() });
          known.add(msg.id);
        }
      }

      if (found.length > 0) {
        history.push(...found);
      }

      // Re-sort entries to match current chat order where possible.
      const order = new Map<string, number>();
      messages.forEach((msg, idx) => order.set(msg.id, idx));
      history.sort((a, b) => {
        const ai = order.get(a.messageId);
        const bi = order.get(b.messageId);
        if (ai === undefined && bi === undefined) return 0;
        if (ai === undefined) return 1;
        if (bi === undefined) return -1;
        return ai - bi;
      });
    } catch {
      // Rehydration is best-effort.
    }
  }

  /** Return the most recent entries oldest → newest, optionally excluding a message. */
  function getRecentChatTrackers(
    chatId: string | null,
    limit: number,
    excludeMessageId?: string | null,
  ): TrackerHistoryEntry[] {
    if (!chatId || limit <= 0) return [];
    const history = chatTrackerHistory.get(chatId);
    if (!history || history.length === 0) return [];
    const filtered = excludeMessageId
      ? history.filter((entry) => entry.messageId !== excludeMessageId)
      : history.slice();
    if (filtered.length <= limit) return filtered;
    return filtered.slice(filtered.length - limit);
  }

  return { recordChatTracker, forgetChatTracker, getChatTrackerHistory, rehydrateChatTrackerHistory, getRecentChatTrackers };
}
