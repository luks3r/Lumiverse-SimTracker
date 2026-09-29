import type { PendingTrackerPayload } from "./trackerRendering";

type LatestEntry = { messageId?: unknown; payload?: unknown; previousPayload?: unknown } | null;

export function createTrackerHydration(deps: {
  getActiveChatId: () => string | null;
  sendLatestRequest: (chatId: string) => void;
  isConfigReady: () => boolean;
  hasRenderedMessage: (messageId: string) => boolean;
  setComparisonBaseline: (messageId: string, previousPayload: string | null) => void;
  renderPayload: (payload: PendingTrackerPayload) => void;
}) {
  let currentChatId: string | null = null;
  let awaitingLatestTrackerChatId: string | null = null;
  let pendingTrackerPayload: PendingTrackerPayload | null = null;
  let initialTrackerRehydrateRequested = false;
  const requestsInFlight = new Set<string>();

  const requestLatest = (chatId: string) => {
    if (requestsInFlight.has(chatId)) return;
    requestsInFlight.add(chatId);
    awaitingLatestTrackerChatId = chatId;
    deps.sendLatestRequest(chatId);
  };

  const flushPending = () => {
    if (!deps.isConfigReady() || awaitingLatestTrackerChatId || !pendingTrackerPayload) return;
    const pending = pendingTrackerPayload;
    pendingTrackerPayload = null;
    if (pending.chatId && currentChatId && pending.chatId !== currentChatId) return;
    deps.renderPayload(pending);
  };

  return {
    currentChatId: () => currentChatId,
    awaitingChatId: () => awaitingLatestTrackerChatId,
    beginChat: (chatId: string | null) => {
      if (!chatId || chatId === currentChatId) return false;
      currentChatId = chatId;
      awaitingLatestTrackerChatId = chatId;
      pendingTrackerPayload = null;
      return true;
    },
    requestLatest,
    requestInitial: () => {
      if (initialTrackerRehydrateRequested) return;
      try {
        const chatId = deps.getActiveChatId();
        if (!chatId) return;
        initialTrackerRehydrateRequested = true;
        if (!currentChatId) currentChatId = chatId;
        requestLatest(chatId);
      } catch {
        // Host chat lookup is best-effort.
      }
    },
    offerPending: (payload: PendingTrackerPayload) => {
      if (!pendingTrackerPayload?.authoritative) pendingTrackerPayload = payload;
    },
    acceptLatest: (responseChatId: string | null, entry: LatestEntry) => {
      if (responseChatId) requestsInFlight.delete(responseChatId);
      if (responseChatId && currentChatId && responseChatId !== currentChatId) return;
      if (!currentChatId && responseChatId) currentChatId = responseChatId;
      if (!responseChatId || awaitingLatestTrackerChatId === responseChatId) {
        awaitingLatestTrackerChatId = null;
      }
      if (entry && typeof entry.payload === "string" && entry.payload.trim()) {
        const messageId = typeof entry.messageId === "string" ? entry.messageId : null;
        if (messageId && deps.hasRenderedMessage(messageId)) {
          pendingTrackerPayload = null;
          return;
        }
        if (messageId) deps.setComparisonBaseline(messageId, typeof entry.previousPayload === "string" ? entry.previousPayload : null);
        pendingTrackerPayload = {
          raw: entry.payload,
          sourceContent: entry.payload,
          messageId,
          chatId: responseChatId,
          authoritative: true,
        };
      }
      flushPending();
    },
    flushPending,
  };
}

export type TrackerHydration = ReturnType<typeof createTrackerHydration>;
