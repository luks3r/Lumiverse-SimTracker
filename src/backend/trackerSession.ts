import { formatTrackerForPrompt } from "./trackerPayload";
import type { TrackerHistoryEntry } from "./trackerHistory";

/** Coordinates the selected chat, its side-channel history, and the visible macro. */
export function createTrackerSession(deps: {
  recordHistoryTracker: (chatId: string | null, messageId: string | null, payload: string) => void;
  forgetHistoryTracker: (chatId: string | null, messageId: string | null) => void;
  getChatTrackerHistory: (chatId: string | null) => TrackerHistoryEntry[];
  rehydrateHistory: (chatId: string | null) => Promise<void>;
  publishMacroValue: (value: string) => void;
}) {
  const latestTrackerByChat = new Map<string, string>();
  let selectedChatId: string | null = null;
  let selectedChatKnown = false;
  let activeChatId: string | null = null;

  const readLastSimStats = (chatId: string | null): string => {
    if (!chatId) return "{}";
    return latestTrackerByChat.get(chatId) ?? deps.getChatTrackerHistory(chatId).at(-1)?.payload ?? "{}";
  };

  const publishSelectedTracker = () => {
    deps.publishMacroValue(formatTrackerForPrompt(readLastSimStats(selectedChatId)));
  };

  const selectChat = (chatId: string | null) => {
    selectedChatKnown = true;
    selectedChatId = chatId;
    publishSelectedTracker();
  };

  const recordChatTracker = (chatId: string | null, messageId: string | null, payload: string) => {
    deps.recordHistoryTracker(chatId, messageId, payload);
    if (!chatId) return;
    latestTrackerByChat.set(chatId, payload);
    if (!selectedChatKnown) selectChat(chatId);
    else if (selectedChatId === chatId) publishSelectedTracker();
  };

  const forgetChatTracker = (chatId: string | null, messageId: string | null) => {
    deps.forgetHistoryTracker(chatId, messageId);
    if (!chatId) return;
    const latest = deps.getChatTrackerHistory(chatId).at(-1)?.payload;
    if (latest) latestTrackerByChat.set(chatId, latest);
    else latestTrackerByChat.delete(chatId);
    if (selectedChatId === chatId) publishSelectedTracker();
  };

  const rehydrateChatTrackerHistory = async (chatId: string | null) => {
    await deps.rehydrateHistory(chatId);
    if (!chatId) return;
    const latest = deps.getChatTrackerHistory(chatId).at(-1)?.payload;
    if (latest) latestTrackerByChat.set(chatId, latest);
    if (selectedChatId === chatId) publishSelectedTracker();
  };

  const writeLastSimStats = (chatId: string | null, value: string, messageId?: string | null) => {
    if (!chatId) return;
    if (messageId) {
      recordChatTracker(chatId, messageId, value);
      return;
    }
    latestTrackerByChat.set(chatId, value);
    if (!selectedChatKnown) selectChat(chatId);
    else if (selectedChatId === chatId) publishSelectedTracker();
  };

  return {
    readLastSimStats,
    writeLastSimStats,
    publishSelectedTracker,
    selectChat,
    recordChatTracker,
    forgetChatTracker,
    rehydrateChatTrackerHistory,
    isSelectedChatKnown: () => selectedChatKnown,
    readSelectedChatId: () => selectedChatId,
    readActiveChatId: () => activeChatId,
    setActiveChatId: (chatId: string | null) => { activeChatId = chatId; },
  };
}
