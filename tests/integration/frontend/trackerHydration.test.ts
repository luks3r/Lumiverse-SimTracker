import { describe, expect, test } from "bun:test";
import { createTrackerHydration } from "../../../src/frontend/trackerHydration";

describe("tracker hydration", () => {
  test("stale history cannot unblock or render the selected chat", () => {
    const requests: string[] = [];
    const renders: string[] = [];
    const hydration = createTrackerHydration({
      getActiveChatId: () => "chat-b",
      sendLatestRequest: (chatId) => { requests.push(chatId); },
      isConfigReady: () => true,
      hasRenderedMessage: () => false,
      setComparisonBaseline: () => {},
      renderPayload: (payload) => { renders.push(payload.raw); },
    });
    hydration.beginChat("chat-a");
    hydration.requestLatest("chat-a");
    hydration.beginChat("chat-b");
    hydration.requestLatest("chat-b");
    hydration.acceptLatest("chat-a", { payload: "old" });
    hydration.offerPending({ raw: "early", sourceContent: "early", messageId: null, chatId: "chat-b", authoritative: false });
    expect(hydration.awaitingChatId()).toBe("chat-b");
    expect(renders).toEqual([]);
    hydration.acceptLatest("chat-b", { payload: "latest" });
    expect(requests).toEqual(["chat-a", "chat-b"]);
    expect(renders).toEqual(["latest"]);
  });

  test("configuration readiness flushes an early tag once", () => {
    let ready = false;
    const renders: string[] = [];
    const hydration = createTrackerHydration({
      getActiveChatId: () => null,
      sendLatestRequest: () => {},
      isConfigReady: () => ready,
      hasRenderedMessage: () => false,
      setComparisonBaseline: () => {},
      renderPayload: (payload) => { renders.push(payload.raw); },
    });
    hydration.beginChat("chat-a");
    hydration.offerPending({ raw: "early", sourceContent: "early", messageId: null, chatId: "chat-a", authoritative: false });
    hydration.acceptLatest("chat-a", null);
    expect(renders).toEqual([]);
    ready = true;
    hydration.flushPending();
    hydration.flushPending();
    expect(renders).toEqual(["early"]);
  });
});
