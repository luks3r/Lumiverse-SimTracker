import type { SpindleAPI } from "lumiverse-spindle-types";
import type { TrackerConfig } from "../shared/trackerConfig";
import { sanitizeIdentifier, sanitizeTagName } from "../shared/trackerSyntax";
import { readMessageContext } from "./backendMessageContext";
import type { createCommandEngine } from "./commandEngine";

export function registerMessageEvents(deps: {
  spindle: SpindleAPI;
  readConfig: () => TrackerConfig;
  readActiveUserId: () => string | null;
  setActiveChatId: (chatId: string) => void;
  ensureConfigForUser: (userId?: string | null) => Promise<void>;
  rehydrateChatTrackerHistory: (chatId: string | null) => Promise<void>;
  handleSlashCommand: ReturnType<typeof createCommandEngine>["handleSlashCommand"];
  extractTrackerPayloadFromMessage: (content: string) => string | null;
  recordChatTracker: (chatId: string | null, messageId: string | null, payload: string) => void;
  forgetChatTracker: (chatId: string | null, messageId: string | null) => void;
  pushMacroValues: () => void;
  trackEvent: (eventName: string, payload?: Record<string, unknown>, options?: { level?: "debug" | "info" | "warn" | "error"; chatId?: string }) => Promise<void>;
}) {
  const {
    spindle,
    ensureConfigForUser,
    rehydrateChatTrackerHistory,
    handleSlashCommand,
    extractTrackerPayloadFromMessage,
    recordChatTracker,
    forgetChatTracker,
    pushMacroValues,
    trackEvent,
  } = deps;
spindle.on("MESSAGE_SENT", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    const ctx = readMessageContext(payload);
    const message = ctx.content;
    if (typeof message !== "string") return;

    if (ctx.chatId) {
      deps.setActiveChatId(ctx.chatId);
      void rehydrateChatTrackerHistory(ctx.chatId);
    }

    const commandResult = await handleSlashCommand(message, ctx);
    if (commandResult) {
      spindle.sendToFrontend(commandResult, deps.readActiveUserId() || undefined);
      await trackEvent(
        "sst.command.result",
        {
          command: commandResult.payload.command,
          ok: commandResult.payload.ok,
          mode: commandResult.payload.mode || "fallback",
        },
        ctx.chatId ? { chatId: ctx.chatId } : undefined,
      );
    }

    const sim = extractTrackerPayloadFromMessage(message);
    if (sim) {
      recordChatTracker(ctx.chatId, ctx.messageId, sim);
      pushMacroValues();
      await trackEvent("sst.tracker.detected", { identifier: deps.readConfig().codeBlockIdentifier }, ctx.chatId ? { chatId: ctx.chatId } : undefined);
    }
  })();
});

spindle.on("MESSAGE_EDITED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    const ctx = readMessageContext(payload);
    if (ctx.chatId) deps.setActiveChatId(ctx.chatId);
    if (typeof ctx.content !== "string") return;
    const sim = extractTrackerPayloadFromMessage(ctx.content);
    if (sim) {
      recordChatTracker(ctx.chatId, ctx.messageId, sim);
      pushMacroValues();
      await trackEvent("sst.tracker.detected", { identifier: deps.readConfig().codeBlockIdentifier, source: "message_edited" }, ctx.chatId ? { chatId: ctx.chatId } : undefined);
      return;
    }
    // Edit removed the tracker (e.g. swipe to a variant without one) — drop
    // the side-channel entry so stale data doesn't leak into generation.
    forgetChatTracker(ctx.chatId, ctx.messageId);
  })();
});

spindle.on("MESSAGE_SWIPED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;

    const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
    if (chatId) deps.setActiveChatId(chatId);
    const message = obj.message && typeof obj.message === "object"
      ? (obj.message as Record<string, unknown>)
      : null;
    if (!chatId || !message) return;

    const messageId = typeof message.id === "string" ? message.id : null;
    if (!messageId) return;

    const action = typeof obj.action === "string" ? obj.action : "";
    const activeSwipeId = typeof message.swipe_id === "number" ? message.swipe_id : 0;

    // Determine which swipe's content is authoritative for this event.
    //   - added     : the new swipe, which is `swipes[swipe_id]` (usually the
    //                 one just created). `content` mirrors it.
    //   - updated   : the edited swipe. If the edited slot is the active one,
    //                 `content` reflects it; otherwise we still prefer the
    //                 active slot because that's what downstream generation
    //                 will actually see.
    //   - deleted   : `content` is the post-deletion active swipe.
    //   - navigated : `content` is the destination swipe.
    // In every case `message.content` (= `swipes[swipe_id]`) is the right
    // source, so we don't need to special-case per action.
    const activeContent = typeof message.content === "string"
      ? message.content
      : Array.isArray(message.swipes) && typeof message.swipes[activeSwipeId] === "string"
        ? (message.swipes[activeSwipeId] as string)
        : "";

    const payloadText = extractTrackerPayloadFromMessage(activeContent);
    if (payloadText) {
      // Re-sync the side-channel to the currently active swipe's tracker.
      // This is essential so that when the user cycles between swipe
      // variants, subsequent generations (main or secondary) reference the
      // tracker data that actually matches the on-screen narrative rather
      // than whichever variant was last recorded.
      recordChatTracker(chatId, messageId, payloadText);
      pushMacroValues();
    } else {
      // The active swipe has no tracker tag. Drop the side-channel entry
      // for this message so it isn't used as "prior state" for the next
      // generation. This also correctly handles the `added` case where a
      // brand-new swipe slot starts empty pending generation — by clearing
      // M(n)'s stale entry we guarantee the new generation references the
      // previous message's tracker, not the previous swipe's.
      forgetChatTracker(chatId, messageId);
    }

    await trackEvent(
      "sst.swipe.synced",
      { action, swipeId: typeof obj.swipeId === "number" ? obj.swipeId : null },
      { chatId },
    );
  })();
});

spindle.on("MESSAGE_TAG_INTERCEPTED", (payload: unknown, userId?: string) => {
  void (async () => {
    await ensureConfigForUser(userId);
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    const tagName = typeof obj.tagName === "string" ? sanitizeTagName(obj.tagName) : "";
    if (tagName !== sanitizeTagName(deps.readConfig().trackerTagName)) return;

    const attrs = obj.attrs && typeof obj.attrs === "object" ? (obj.attrs as Record<string, unknown>) : {};
    const tagType = sanitizeIdentifier(typeof attrs.type === "string" ? attrs.type : "");
    if (tagType && tagType !== sanitizeIdentifier(deps.readConfig().codeBlockIdentifier)) return;

    const content = typeof obj.content === "string" ? obj.content.trim() : "";
    if (!content) return;

    const isStreaming = obj.isStreaming === true;
    // Skip mid-stream fragments — they're usually incomplete tracker payloads
    // and would overwrite the last good record with a partial one. The final
    // completed tag is delivered with isStreaming=false (or via MESSAGE_SENT /
    // MESSAGE_EDITED as a fallback).
    if (isStreaming) return;

    const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
    const messageId = typeof obj.messageId === "string" ? obj.messageId : null;
    if (chatId) deps.setActiveChatId(chatId);

    recordChatTracker(chatId, messageId, content);
    pushMacroValues();
    await trackEvent("sst.tracker.detected", { identifier: deps.readConfig().codeBlockIdentifier, source: "message_tag_intercepted" });
  })();
});
}
