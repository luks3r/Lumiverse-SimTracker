import { describe, expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { registerChatEvents } from "../../../src/frontend/chatEvents";
import type { InlineProcessor } from "../../../src/frontend/inlineTemplates";

describe("frontend chat lifecycle", () => {
  test("switching chats clears the old render and ignores late events from that chat", () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const removedMounts: Element[] = [];
    const requestedChats: string[] = [];
    const renderedMessages: string[] = [];
    const oldMount = {} as Element;
    let inlineDestroyCount = 0;
    let generatingClears = 0;
    let sideClears = 0;
    let activeChatId = "chat-a";
    const state: Parameters<typeof registerChatEvents>[0]["state"] = {
      currentChatId: "chat-a",
      awaitingLatestTrackerChatId: null,
      pendingTrackerPayload: { raw: "old", sourceContent: "old", messageId: "message-a", chatId: "chat-a", authoritative: true },
      configReady: false,
      latestTrackerMessageId: "message-a",
      previousTrackerData: { characters: [{ name: "Alice" }] },
      trackerComparisonBaselines: new Map([["message-a", null]]),
      latestTrackerRaw: "old",
      latestTrackerSourceContent: "old",
      latestContent: "old",
      latestMessageRenderIntent: null,
      trackerMessageRenders: new Map(),
      trackerMessageIds: new Set(["message-a"]),
      trackerMessageMounts: new Map([["message-a", oldMount]]),
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
      dom: { uninject: (mount: Element) => { removedMounts.push(mount); } },
      messages: { getLatestMessageId: () => null },
    } as unknown as SpindleFrontendContext;
    const inlineProcessor: InlineProcessor = {
      processMessage: () => {},
      processAll: () => {},
      clearMessage: () => {},
      observeDocument: () => () => {},
      destroy: () => { inlineDestroyCount += 1; },
    };
    const subscriptions = registerChatEvents({
      ctx,
      state,
      inlineProcessor,
      updateRegenerateButton: () => {},
      renderEmpty: () => {},
      requestLatestTracker: (chatId) => { requestedChats.push(chatId); },
      handleContent: (_content, messageId) => { if (messageId) renderedMessages.push(messageId); },
      clearSideTrackerRender: () => { sideClears += 1; },
      clearMessageTrackerRender: () => {},
      retryLatestMessageRenderIntent: () => {},
      retryGeneratingIndicator: () => {},
      clearLatestMessageRenderIntent: () => {},
      hideGeneratingIndicator: () => {},
      hideAllGeneratingIndicators: () => { generatingClears += 1; },
      renderCapabilities: () => {},
      updatePermissionGatedControls: () => {},
    });

    activeChatId = "chat-b";
    handlers.get("CHAT_SWITCHED")?.({ chatId: "chat-b" });
    handlers.get("GENERATION_ENDED")?.({ chatId: "chat-a", messageId: "late-a", content: "stale tracker" });
    handlers.get("GENERATION_ENDED")?.({ chatId: "chat-b", messageId: "message-b", content: "new tracker" });

    expect(state.currentChatId).toBe("chat-b");
    expect(state.awaitingLatestTrackerChatId).toBe("chat-b");
    expect(state.pendingTrackerPayload).toBeNull();
    expect(state.trackerMessageIds.size).toBe(0);
    expect(removedMounts).toEqual([oldMount]);
    expect(requestedChats).toEqual(["chat-b"]);
    expect(renderedMessages).toEqual(["message-b"]);
    expect(inlineDestroyCount).toBe(1);
    expect(generatingClears).toBe(1);
    expect(sideClears).toBe(1);

    subscriptions.generationUnsub();
    subscriptions.chatSwitchedUnsub();
    subscriptions.stopInlineObserver();
  });
});
