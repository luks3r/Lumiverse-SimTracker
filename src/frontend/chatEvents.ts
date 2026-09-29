import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { TrackerData } from "../shared/trackerData";
import { readMessageContext } from "./frontendMessageSyntax";
import type { createInlineTemplateProcessor } from "./inlineTemplates";
import type { PendingTrackerPayload, TrackerRenderInputs, LatestMessageRenderIntent } from "./trackerRendering";

export function registerChatEvents(deps: {
  ctx: SpindleFrontendContext;
  state: {
    currentChatId: string | null;
    awaitingLatestTrackerChatId: string | null;
    pendingTrackerPayload: PendingTrackerPayload | null;
    configReady: boolean;
    latestTrackerMessageId: string | null;
    previousTrackerData: TrackerData | null;
    trackerComparisonBaselines: Map<string, TrackerData | null>;
    latestTrackerRaw: string | null;
    latestTrackerSourceContent: string | null;
    latestContent: string | null;
    latestMessageRenderIntent: LatestMessageRenderIntent | null;
    trackerMessageRenders: Map<string, TrackerRenderInputs>;
    trackerMessageIds: Set<string>;
    trackerMessageMounts: Map<string, Element>;
    grantedPermissions: string[];
    requestedPermissions: string[];
    ephemeralPoolStatus: Record<string, unknown> | null;
  };
  inlineProcessor: ReturnType<typeof createInlineTemplateProcessor>;
  updateRegenerateButton: () => void;
  renderEmpty: (message: string) => void;
  requestLatestTracker: (chatId: string) => void;
  handleContent: (content: string, messageId: string | null) => void;
  clearSideTrackerRender: () => void;
  clearMessageTrackerRender: (messageId: string) => void;
  retryLatestMessageRenderIntent: (messageId: string | null) => void;
  retryGeneratingIndicator: (messageId: string | null) => void;
  clearLatestMessageRenderIntent: (messageId?: string | null) => void;
  hideGeneratingIndicator: (messageId: string) => void;
  hideAllGeneratingIndicators: () => void;
  renderCapabilities: (granted: string[], requested: string[], ephemeral: Record<string, unknown> | null) => void;
  updatePermissionGatedControls: () => void;
}) {
  const {
    ctx, state, inlineProcessor, updateRegenerateButton, renderEmpty,
    requestLatestTracker, handleContent, clearSideTrackerRender,
    clearMessageTrackerRender, retryLatestMessageRenderIntent,
    retryGeneratingIndicator, clearLatestMessageRenderIntent,
    hideGeneratingIndicator, hideAllGeneratingIndicators, renderCapabilities,
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
    if (!chatId || chatId === state.currentChatId) return;
    state.currentChatId = chatId;
    state.awaitingLatestTrackerChatId = chatId;
    state.pendingTrackerPayload = null;
    updateRegenerateButton();
    resetChatState();
    renderEmpty("When a message includes a tracker tag, cards will appear here.");
    requestLatestTracker(chatId);
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
    if (hostActiveChatId && hostActiveChatId !== state.currentChatId) {
      handleChatSwitch(hostActiveChatId);
    }

    const activeChatId = hostActiveChatId || state.currentChatId;
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
    clearSideTrackerRender();
    if (state.latestTrackerMessageId) {
      clearMessageTrackerRender(state.latestTrackerMessageId);
      inlineProcessor.clearMessage(state.latestTrackerMessageId);
    }
    if (context.messageId) inlineProcessor.clearMessage(context.messageId);
    state.previousTrackerData = null;
    state.trackerComparisonBaselines.clear();
    state.latestTrackerRaw = null;
    state.latestTrackerSourceContent = null;
    state.latestContent = null;
    state.latestMessageRenderIntent = null;

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
    retryLatestMessageRenderIntent(context.messageId);
    retryGeneratingIndicator(context.messageId);
    const latestMountedId = ctx.messages.getLatestMessageId();
    const needsLatestAttach =
      !!context.messageId &&
      context.messageId === latestMountedId &&
      state.latestMessageRenderIntent?.messageId !== context.messageId &&
      !state.trackerMessageRenders.has(context.messageId);
    if (needsLatestAttach && context.content) {
      handleContent(context.content, context.messageId);
    }
    runInlinePass(context.messageId);
  };

  const onMessageDeleted = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context || !context.messageId) return;
    // Tear down any local tracker render and forget the message so the
    // regenerate button and the side panel don't reference a ghost.
    if (state.trackerMessageIds.has(context.messageId)) {
      state.trackerMessageIds.delete(context.messageId);
      clearLatestMessageRenderIntent(context.messageId);
      clearMessageTrackerRender(context.messageId);
    }
    state.trackerComparisonBaselines.delete(context.messageId);
    hideGeneratingIndicator(context.messageId);
    inlineProcessor.clearMessage(context.messageId);
    if (state.latestTrackerMessageId === context.messageId) {
      state.latestTrackerMessageId = null;
      state.previousTrackerData = null;
      state.trackerComparisonBaselines.clear();
      state.latestTrackerRaw = null;
      state.latestTrackerSourceContent = null;
      state.latestContent = null;
      clearSideTrackerRender();
      updateRegenerateButton();
    }
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
    state.previousTrackerData = null;
    state.trackerComparisonBaselines.clear();
    state.latestTrackerMessageId = null;
    state.latestTrackerRaw = null;
    state.latestTrackerSourceContent = null;
    state.latestContent = null;
    state.latestMessageRenderIntent = null;
    state.trackerMessageIds.clear();
    updateRegenerateButton();
    for (const mount of state.trackerMessageMounts.values()) ctx.dom.uninject(mount);
    state.trackerMessageMounts.clear();
    state.trackerMessageRenders.clear();
    hideAllGeneratingIndicators();
    clearSideTrackerRender();
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
