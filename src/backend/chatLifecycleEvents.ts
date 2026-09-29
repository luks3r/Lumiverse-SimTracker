import type { SpindleAPI } from "lumiverse-spindle-types";
import type { TrackerConfig } from "../shared/trackerConfig";
import { buildFirstMessageHint } from "../shared/fertilityCycleHint";
import { readMessageContext } from "./backendMessageContext";
import { runHostEventTask } from "./hostEventTask";

export function registerChatLifecycleEvents(deps: {
  spindle: SpindleAPI;
  readConfig: () => TrackerConfig;
  ensureConfigForUser: (userId?: string | null) => Promise<void>;
  isSelectedChatKnown: () => boolean;
  selectChat: (chatId: string | null) => void;
  setActiveChatId: (chatId: string) => void;
  rehydrateChatTrackerHistory: (chatId: string | null) => Promise<void>;
  getChatTrackerHistory: (chatId: string | null) => Array<{ messageId: string; payload: string }>;
  readFirstMessageFertilityHint: () => string;
  writeFirstMessageFertilityHint: (hint: string) => void;
  pushMacroValues: () => void;
  forgetChatTracker: (chatId: string | null, messageId: string | null) => void;
  hasPermission: (name: string) => boolean;
  extractTrackerPayloadFromMessage: (content: string) => string | null;
  recordChatTracker: (chatId: string | null, messageId: string | null, payload: string) => void;
  enqueueSecondaryGeneration: (chatId: string, messageId: string) => Promise<void>;
}) {
  const {
    spindle,
    ensureConfigForUser,
    selectChat,
    rehydrateChatTrackerHistory,
    getChatTrackerHistory,
    pushMacroValues,
    forgetChatTracker,
    hasPermission,
    extractTrackerPayloadFromMessage,
    recordChatTracker,
    enqueueSecondaryGeneration,
  } = deps;
// `GENERATION_STARTED` fires immediately before the interceptor runs and
// reliably carries the active chat id in its typed payload. Mirror it into
// `activeChatId` so the interceptor can fall back on it when its `context`
// argument (typed as `unknown` in the SDK) doesn't surface one. Also use
// this as the trigger to prime the side-channel for chats the extension
// hasn't observed activity on yet (e.g. first generation after reload).
spindle.on("GENERATION_STARTED", (payload: unknown, userId?: string) => {
  runHostEventTask(spindle, "GENERATION_STARTED", async () => {
    await ensureConfigForUser(userId);
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
    if (!chatId) return;
    if (!deps.isSelectedChatKnown()) selectChat(chatId);
    deps.setActiveChatId(chatId);
    await rehydrateChatTrackerHistory(chatId);

    // Brand-new chat: exactly one user message and no tracker history yet.
    // Bake the fertility-cycle seed hint into the {{sim_tracker}} macro so it
    // reaches the model alongside the tracker instructions.
    const previousHint = deps.readFirstMessageFertilityHint();
    deps.writeFirstMessageFertilityHint("");
    try {
      const isNewChat = getChatTrackerHistory(chatId).length === 0
        && await (async () => {
          const msgs = await spindle.chat.getMessages(chatId);
          return msgs.filter((m) => m.role === "user").length === 1;
        })();
      if (isNewChat) {
        deps.writeFirstMessageFertilityHint(buildFirstMessageHint(deps.readConfig().fertilityCycleBias));
      }
    } catch {
      // If message introspection fails, leave the hint empty.
    }
    if (previousHint !== deps.readFirstMessageFertilityHint()) pushMacroValues();
  });
});

spindle.on("CHAT_SWITCHED", (payload: unknown, userId?: string) => {
  const obj = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const chatId = typeof obj.chatId === "string"
    ? obj.chatId
    : typeof obj.chat_id === "string"
      ? obj.chat_id
      : null;
  selectChat(chatId);
  runHostEventTask(spindle, "CHAT_SWITCHED", async () => {
    await ensureConfigForUser(userId);
    if (chatId) deps.setActiveChatId(chatId);
    if (chatId) {
      await rehydrateChatTrackerHistory(chatId);
    }
  });
});

// When a message disappears, evict its side-channel entry. Without this,
// `getRecentChatTrackers` would still surface the deleted message's
// tracker as "previous state" on a future regenerate, and the side panel
// could keep pointing at a row the user removed.
spindle.on("MESSAGE_DELETED", (payload: unknown, userId?: string) => {
  runHostEventTask(spindle, "MESSAGE_DELETED", async () => {
    await ensureConfigForUser(userId);
    const ctx = readMessageContext(payload);
    if (!ctx.chatId || !ctx.messageId) return;
    forgetChatTracker(ctx.chatId, ctx.messageId);
    spindle.log.info(`Forgot tracker side-channel entry for deleted message ${ctx.messageId} in chat ${ctx.chatId}`);
  });
});

spindle.on("GENERATION_ENDED", (payload: unknown, userId?: string) => {
  runHostEventTask(spindle, "GENERATION_ENDED", async () => {
    await ensureConfigForUser(userId);
    const ctx = readMessageContext(payload);
    if (ctx.chatId) {
      deps.setActiveChatId(ctx.chatId);
      runHostEventTask(spindle, "GENERATION_ENDED rehydrate", () => rehydrateChatTrackerHistory(ctx.chatId));
    }

    if (!deps.readConfig().useSecondaryLLM) return;
    if (!hasPermission("generation") || !hasPermission("chat_mutation")) return;
    if (!ctx.chatId) return;

    let chatMessages: Array<{ id: string; role: "system" | "user" | "assistant"; content: string }>;
    try {
      chatMessages = await spindle.chat.getMessages(ctx.chatId);
    } catch {
      return;
    }

    const latestAssistant = chatMessages.findLast((m) => m.role === "assistant");
    if (!latestAssistant) return;

    // If the latest assistant already has a tracker in its canonical content,
    // capture it into the side-channel before skipping secondary generation
    // — that way future runs still see it even if subsequent edits/swipes
    // strip the tag.
    const existingPayload = extractTrackerPayloadFromMessage(latestAssistant.content);
    if (existingPayload) {
      recordChatTracker(ctx.chatId, latestAssistant.id, existingPayload);
      return;
    }

    // Enqueue serially — never drop a request because a previous secondary
    // is still in flight, which is what caused "last message sometimes has
    // no tracker" when users replied faster than the sidecar completed.
    void enqueueSecondaryGeneration(ctx.chatId, latestAssistant.id);
  });
});
}
