import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { readMessageContext } from "./frontendMessageSyntax";
import type { createInlineTemplateProcessor } from "./inlineTemplates";
import type { TrackerHydration } from "./trackerHydration";

export function registerChatEvents(deps: {
  ctx: SpindleFrontendContext;
  state: {
    configReady: boolean;
    grantedPermissions: string[];
    requestedPermissions: string[];
    ephemeralPoolStatus: Record<string, unknown> | null;
  };
  hydration: TrackerHydration;
  inlineProcessor: ReturnType<typeof createInlineTemplateProcessor>;
  updateRegenerateButton: () => void;
  renderEmpty: (message: string) => void;
  handleContent: (content: string, messageId: string | null) => void;
  handleMessageRendered: (messageId: string | null, content: string | null) => void;
  resetTrackerForChat: () => void;
  clearForSwipe: (messageId: string | null, clearInlineMessage: (messageId: string) => void) => void;
  forgetMessage: (messageId: string, clearInlineMessage: (messageId: string) => void) => void;
  renderCapabilities: (granted: string[], requested: string[], ephemeral: Record<string, unknown> | null) => void;
  updatePermissionGatedControls: () => void;
}) {
  const {
    ctx, state, inlineProcessor, updateRegenerateButton, renderEmpty,
    handleContent, renderCapabilities,
    updatePermissionGatedControls,
  } = deps;
  const runInlinePass = (messageId: string | null) => {
    if (messageId) inlineProcessor.processMessage(messageId);
    else inlineProcessor.processAll();
  };

  const extractChatId = (payload: unknown): string | null => {
    if (!payload || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    const direct = typeof obj.chatId === "string" ? obj.chatId : typeof obj.chat_id === "string" ? obj.chat_id : null;
    if (direct) return direct;
    const nested = obj.message as Record<string, unknown> | undefined;
    return typeof nested?.chatId === "string" ? nested.chatId : typeof nested?.chat_id === "string" ? nested.chat_id : null;
  };

  const handleChatSwitch = (chatId: string | null) => {
    if (!chatId || !deps.hydration.beginChat(chatId)) return;
    updateRegenerateButton();
    resetChatState();
    renderEmpty("When a message includes a tracker tag, cards will appear here.");
    deps.hydration.requestLatest(chatId);
    // Wait two frames for Lumiverse to finish painting the new chat's
    // messages before running the inline-template sweep.
    if (state.configReady) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        inlineProcessor.processAll();
      }));
    }
  };

  const isActivityForActiveChat = (activityChatId: string | null): boolean => {
    let hostActiveChatId: string | null = null;
    try {
      const active = ctx.getActiveChat();
      hostActiveChatId = active?.chatId || null;
    } catch {
      // Fall back to the last explicit CHAT_SWITCHED event on older hosts.
    }

    // Synchronize to the host's actual selection, never to the chat named by
    // an arbitrary generation/message event (which may be a queued chat).
    if (hostActiveChatId && hostActiveChatId !== deps.hydration.currentChatId()) {
      handleChatSwitch(hostActiveChatId);
    }

    const activeChatId = hostActiveChatId || deps.hydration.currentChatId();
    if (!activeChatId) {
      // Startup fallback for hosts where getActiveChat() is unavailable and
      // CHAT_SWITCHED has not fired yet.
      if (activityChatId) handleChatSwitch(activityChatId);
      return true;
    }
    return !activityChatId || activityChatId === activeChatId;
  };

  const onEvent = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context) return;
    if (context.isUser === true) return;
    if (context.content) handleContent(context.content, context.messageId);
    runInlinePass(context.messageId);
  };

  const onSwipe = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context) return;
    if (context.isUser === true) return;

    // Proactively clear all tracker renders on every swipe.
    // Historical swipes (content has tracker data) will re-render immediately below.
    // New-generation swipes (empty content) stay cleared until GENERATION_ENDED.
    deps.clearForSwipe(context.messageId, (id) => inlineProcessor.clearMessage(id));

    // If the swiped-to message already has content (historical), process it now.
    if (context.content) {
      handleContent(context.content, context.messageId);
    }
    runInlinePass(context.messageId);
  };

  const onMessageRendered = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context || context.isUser === true) return;
    deps.handleMessageRendered(context.messageId, context.content);
    runInlinePass(context.messageId);
  };

  const onMessageDeleted = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context || !context.messageId) return;
    // Tear down any local tracker render and forget the message so the
    // regenerate button and the side panel don't reference a ghost.
    deps.forgetMessage(context.messageId, (id) => inlineProcessor.clearMessage(id));
    // The backend has its own MESSAGE_DELETED subscription that drops the
    // side-channel entry, so no frontend → backend bridge needed here.
  };

  // Virtualization replay is handled host-side: the wrapper returned by
  // ctx.dom.inject() is preserved across scroll-away/scroll-back and moved
  // back into the remounted bubble with its identity, form state, and
  // listeners intact. We keep the latest render intent around so
  // CHARACTER_MESSAGE_RENDERED can finish the first attach as soon as the
  // newest bubble mounts, then trust the host to keep it attached.

  const resetChatState = () => {
    deps.resetTrackerForChat();
    inlineProcessor.destroy();
  };

  const generationUnsub = ctx.events.on("GENERATION_ENDED", onEvent);
  const messageUnsub = ctx.events.on("MESSAGE_SENT", onEvent);
  const messageEditedUnsub = ctx.events.on("MESSAGE_EDITED", onEvent);
  const messageSwipedUnsub = ctx.events.on("MESSAGE_SWIPED", onSwipe);
  // SWIPE_EDITED is coarser than MESSAGE_SWIPED and fires when another
  // extension rewrites the swipe array via chat.updateMessage(). The
  // payload carries the full post-mutation message, so we can reuse
  // the swipe pipeline to re-process whatever the new content is.
  const swipeEditedUnsub = ctx.events.on("SWIPE_EDITED", onSwipe);
  const messageDeletedUnsub = ctx.events.on("MESSAGE_DELETED", onMessageDeleted);
  const messageRenderedUnsub = ctx.events.on("CHARACTER_MESSAGE_RENDERED", onMessageRendered);
  // Spindle emits CHAT_SWITCHED with `{ chatId: string | null }` on
  // navigation. Subscribing directly means the panel notices a chat change
  // even when no message activity follows it (e.g. opening an empty chat
  // or jumping between two chats without sending anything).
  const chatSwitchedUnsub = ctx.events.on("CHAT_SWITCHED", (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
    handleChatSwitch(chatId);
  });

  const stopInlineObserver = inlineProcessor.observeDocument();

  const permissionUnsub = ctx.events.on("PERMISSION_CHANGED", (detail: unknown) => {
    if (!detail || typeof detail !== "object") return;
    const ev = detail as Record<string, unknown>;
    const allGranted = Array.isArray(ev.allGranted)
      ? ev.allGranted.filter((p): p is string => typeof p === "string")
      : null;
    if (allGranted) {
      state.grantedPermissions = allGranted;
      renderCapabilities(state.grantedPermissions, state.requestedPermissions, state.ephemeralPoolStatus);
      updatePermissionGatedControls();
    }
  });


  return {
    isActivityForActiveChat,
    generationUnsub,
    messageUnsub,
    messageEditedUnsub,
    messageSwipedUnsub,
    swipeEditedUnsub,
    messageDeletedUnsub,
    messageRenderedUnsub,
    chatSwitchedUnsub,
    stopInlineObserver,
    permissionUnsub,
  };
}
