import { describe, expect, test } from "bun:test";
import { readWireConnectionProfiles, readWireMessage, readWireRecords, readWireTemplatePresets } from "../../../src/shared/wireMessages";

describe("extension wire messages", () => {
  test("rejects malformed state-bearing responses before dispatch", () => {
    expect(readWireMessage({ type: "config", config: [] })).toBeNull();
    expect(readWireMessage({ type: "tracker_history_latest", chatId: "chat-a", entry: [] })).toBeNull();
    expect(readWireMessage({ type: "command_result", payload: [] })).toBeNull();
    expect(readWireMessage({ type: "connections_list", connections: {} })).toBeNull();
    expect(readWireMessage({ type: "config", config: { templateId: "bento-style-tracker" } })).not.toBeNull();
    expect(readWireMessage({ type: "tracker_history_latest", chatId: "chat-a", entry: null })).not.toBeNull();
    expect(readWireMessage({ type: "connections_list", connections: [] })).not.toBeNull();
  });

  test("accepts only usable records in wire collections", () => {
    expect(readWireRecords([{ enabled: true }, [], null])).toEqual([{ enabled: true }]);
    expect(readWireTemplatePresets([{ id: "custom", templateName: "Custom" }, { id: 1, templateName: "Bad" }])).toEqual([{ id: "custom", templateName: "Custom" }]);
    expect(readWireConnectionProfiles([
      { id: "conn", name: "Default", provider: "openai", model: "gpt", is_default: true, has_api_key: true },
      { id: 1, name: "Bad", provider: "openai", model: "gpt", is_default: false, has_api_key: false },
    ])).toEqual([{ id: "conn", name: "Default", provider: "openai", model: "gpt", is_default: true, has_api_key: true }]);
  });
});
