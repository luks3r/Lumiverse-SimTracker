import { describe, expect, test } from "bun:test";
import { createTrackerSession } from "../../../src/backend/trackerSession";

describe("selected tracker session", () => {
  test("only the selected chat changes last_sim_stats", () => {
    const history = new Map<string, Array<{ messageId: string; payload: string }>>();
    const published: string[] = [];
    const session = createTrackerSession({
      recordHistoryTracker: (chatId, messageId, payload) => {
        if (chatId && messageId) history.set(chatId, [...(history.get(chatId) || []), { messageId, payload }]);
      },
      forgetHistoryTracker: (chatId, messageId) => {
        if (chatId) history.set(chatId, (history.get(chatId) || []).filter((entry) => entry.messageId !== messageId));
      },
      getChatTrackerHistory: (chatId) => chatId ? history.get(chatId) || [] : [],
      rehydrateHistory: async () => {},
      publishMacroValue: (value) => { published.push(value); },
    });

    session.selectChat("chat-a");
    session.recordChatTracker("chat-a", "a-1", '{"characters":[{"name":"Alice"}]}');
    const selectedValue = published.at(-1);
    session.recordChatTracker("chat-b", "b-1", '{"characters":[{"name":"Bob"}]}');
    expect(published.at(-1)).toBe(selectedValue);
    session.selectChat("chat-b");
    expect(published.at(-1)).toContain("Bob");
    session.forgetChatTracker("chat-b", "b-1");
    expect(published.at(-1)).toBe("- Tracker: (none yet)");
    session.selectChat("chat-a");
    expect(published.at(-1)).toContain("Alice");
  });

  test("late rehydration cannot select or publish another chat", async () => {
    const published: string[] = [];
    const session = createTrackerSession({
      recordHistoryTracker: () => {},
      forgetHistoryTracker: () => {},
      getChatTrackerHistory: (chatId) => chatId === "chat-a"
        ? [{ messageId: "a-1", payload: '{"characters":[{"name":"Alice"}]}' }]
        : [{ messageId: "b-1", payload: '{"characters":[{"name":"Bob"}]}' }],
      rehydrateHistory: async () => {},
      publishMacroValue: (value) => { published.push(value); },
    });
    session.selectChat("chat-b");
    const selectedValue = published.at(-1);
    await session.rehydrateChatTrackerHistory("chat-a");
    expect(published.at(-1)).toBe(selectedValue);
    expect(session.readSelectedChatId()).toBe("chat-b");
  });
});
