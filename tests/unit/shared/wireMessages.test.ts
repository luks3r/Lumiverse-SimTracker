import { describe, expect, test } from "bun:test";
import { readWireMessage } from "../../../src/shared/wireMessages";

describe("extension wire messages", () => {
  test("rejects malformed state-bearing responses before dispatch", () => {
    expect(readWireMessage({ type: "config", config: [] })).toBeNull();
    expect(readWireMessage({ type: "tracker_history_latest", chatId: "chat-a", entry: [] })).toBeNull();
    expect(readWireMessage({ type: "config", config: { templateId: "bento-style-tracker" } })).not.toBeNull();
    expect(readWireMessage({ type: "tracker_history_latest", chatId: "chat-a", entry: null })).not.toBeNull();
  });
});
