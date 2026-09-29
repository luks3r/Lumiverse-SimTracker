import { describe, expect, test } from "bun:test";
import { createTrackerMessageCodec } from "../../../src/backend/trackerMessageCodec";
import { createTrackerPromptRetention } from "../../../src/backend/trackerPromptRetention";

describe("tracker prompt retention", () => {
  test("keeps newest tracker across messages", () => {
    const options = { trackerTagName: "tracker", codeBlockIdentifier: "sim" };
    const codec = createTrackerMessageCodec(() => options);
    const retention = createTrackerPromptRetention(() => options, codec);
    const messages = [
      { role: "assistant", content: '<tracker type="sim">{"turn":1}</tracker>' },
      { role: "assistant", content: '<tracker type="sim">{"turn":2}</tracker>' },
    ];
    const output = retention.stripOldTrackerBlocksGlobal(messages, "sim", 1);
    expect(output[0].content).toBe("");
    expect(output[1].content).toContain('"turn":2');
    expect(messages[0].content).toContain('"turn":1');
  });

  test("formats retained tracker for prompt context", () => {
    const options = { trackerTagName: "tracker", codeBlockIdentifier: "sim" };
    const codec = createTrackerMessageCodec(() => options);
    const retention = createTrackerPromptRetention(() => options, codec);
    const output = retention.formatTrackerBlocksInMessages([
      { role: "assistant", content: 'Scene <tracker type="sim">{"turn":2}</tracker>' },
    ]);
    expect(output[0].content).toContain("Previous tracker state:\n- turn: 2");
  });
});
