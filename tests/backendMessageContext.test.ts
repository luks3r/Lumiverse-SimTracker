import { describe, expect, test } from "bun:test";
import { readMessageContext } from "../src/backend/backendMessageContext";

describe("backend message context", () => {
  test("uses nested content and explicit outer IDs first", () => {
    expect(readMessageContext({
      chatId: "chat-outer",
      messageId: "message-outer",
      content: "outer",
      message: { id: "message-inner", content: "inner" },
      chat: { id: "chat-inner" },
    })).toEqual({ chatId: "chat-outer", messageId: "message-outer", content: "inner" });
  });

  test("falls back through alternate keys and ignores blank IDs", () => {
    expect(readMessageContext({
      chatId: "  ",
      chat: { id: "chat-nested" },
      message: { messageId: "message-nested", content: "" },
      content: "outer",
    })).toEqual({ chatId: "chat-nested", messageId: "message-nested", content: "outer" });
  });

  test("returns null fields for invalid input", () => {
    expect(readMessageContext(null)).toEqual({ chatId: null, messageId: null, content: null });
  });
});
