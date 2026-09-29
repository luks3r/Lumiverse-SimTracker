import { describe, expect, test } from "bun:test";
import { createTrackerMessageCodec } from "../../../src/backend/trackerMessageCodec";

describe("tracker message codec", () => {
  test("normalizes legacy hidden divs without losing tracker data", () => {
    const codec = createTrackerMessageCodec(() => ({ trackerTagName: "tracker", codeBlockIdentifier: "sim" }));
    const legacy = '<div style="display:none"><pre>```sim\n{"turn":2}\n```</pre></div>';
    expect(codec.extractTrackerPayloadFromMessage(legacy)).toBe('{"turn":2}');
    expect(codec.normalizeLegacyHiddenDivTrackers(legacy)).toEqual({
      content: '<tracker type="sim">\n{"turn":2}\n</tracker>',
      replacements: 1,
    });
  });

  test("reads current tag and identifier after settings change", () => {
    let options = { trackerTagName: "tracker", codeBlockIdentifier: "sim" };
    const codec = createTrackerMessageCodec(() => options);
    options = { trackerTagName: "state", codeBlockIdentifier: "data" };
    expect(codec.extractTrackerPayloadFromMessage('<state type="data">{"turn":3}</state>')).toBe('{"turn":3}');
  });
});
