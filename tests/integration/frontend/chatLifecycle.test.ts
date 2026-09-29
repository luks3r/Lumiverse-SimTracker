import { describe, expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { registerChatEvents } from "../../../src/frontend/chatEvents";
import { createTrackerHydration } from "../../../src/frontend/trackerHydration";
import type { InlineProcessor } from "../../../src/frontend/inlineTemplates";

describe("frontend chat lifecycle", () => {
  test("switching chats clears the old render and ignores late events from that chat", () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const requestedChats: string[] = [];
    const renderedMessages: string[] = [];
    let inlineDestroyCount = 0;
    let resetCount = 0;
    let activeChatId = "chat-a";
    const state: Parameters<typeof registerChatEvents>[0]["state"] = {
      configReady: false,
      grantedPermissions: [],
      requestedPermissions: [],
      ephemeralPoolStatus: null,
    };
    const ctx = {
      events: {
        on: (event: string, handler: (payload: unknown) => void) => {
          handlers.set(event, handler);
          return () => { handlers.delete(event); };
        },
      },
      getActiveChat: () => ({ chatId: activeChatId }),
      dom: { uninject: () => {} },
      messages: { getLatestMessageId: () => null },
    } as unknown as SpindleFrontendContext;
    const inlineProcessor: InlineProcessor = {
      processMessage: () => {},
      processAll: () => {},
      clearMessage: () => {},
      observeDocument: () => () => {},
      destroy: () => { inlineDestroyCount += 1; },
    };
    const hydration = createTrackerHydration({
      getActiveChatId: () => activeChatId,
      sendLatestRequest: (chatId) => { requestedChats.push(chatId); },
      isConfigReady: () => false,
      hasRenderedMessage: () => false,
      setComparisonBaseline: () => {},
      renderPayload: () => {},
    });
    hydration.beginChat("chat-a");
    hydration.acceptLatest("chat-a", null);
    hydration.offerPending({ raw: "old", sourceContent: "old", messageId: "message-a", chatId: "chat-a", authoritative: true });
    const subscriptions = registerChatEvents({
      ctx,
      state,
      hydration,
      inlineProcessor,
      updateRegenerateButton: () => {},
      renderEmpty: () => {},
      resetTrackerForChat: () => { resetCount += 1; },
      clearForSwipe: () => {},
      forgetMessage: () => {},
      handleContent: (_content, messageId) => { if (messageId) renderedMessages.push(messageId); },
      handleMessageRendered: () => {},
      renderCapabilities: () => {},
      updatePermissionGatedControls: () => {},
    });

    activeChatId = "chat-b";
    handlers.get("CHAT_SWITCHED")?.({ chatId: "chat-b" });
    handlers.get("GENERATION_ENDED")?.({ chatId: "chat-a", messageId: "late-a", content: "stale tracker" });
    handlers.get("GENERATION_ENDED")?.({ chatId: "chat-b", messageId: "message-b", content: "new tracker" });

    expect(hydration.currentChatId()).toBe("chat-b");
    expect(hydration.awaitingChatId()).toBe("chat-b");
    expect(resetCount).toBe(1);
    expect(requestedChats).toEqual(["chat-b"]);
    expect(renderedMessages).toEqual(["message-b"]);
    expect(inlineDestroyCount).toBe(1);

    subscriptions.generationUnsub();
    subscriptions.chatSwitchedUnsub();
    subscriptions.stopInlineObserver();
  });
});
