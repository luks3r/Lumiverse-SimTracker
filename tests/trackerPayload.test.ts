import { describe, expect, test } from "bun:test";
import { formatTrackerForPrompt, parseGeneratedTrackerPayload, parseTrackerPayload } from "../src/trackerPayload";
import { parseTrackerBlock } from "../src/trackerData";

describe("tracker payload parsing", () => {
  test("accepts JSON and YAML with equivalent data", () => {
    const expected = { worldData: { current_date: "2025-08-10" }, characters: [{ name: "Alice", ap: 75 }] };
    expect(parseTrackerPayload(JSON.stringify(expected))).toEqual(expected);
    expect(parseTrackerPayload("worldData:\n  current_date: 2025-08-10\ncharacters:\n  - name: Alice\n    ap: 75")).toEqual(expected);
  });

  test("preserves plus-sign cleanup and generated code-fence handling", () => {
    expect(parseGeneratedTrackerPayload('```json\n{"characters":[{"name":"Alice","ap":+2}]}\n```'))
      .toEqual({ characters: [{ name: "Alice", ap: 2 }] });
  });

  test("rejects malformed documents and scalar values", () => {
    expect(parseTrackerPayload("{invalid")).toBeNull();
    expect(parseTrackerPayload("42")).toBeNull();
    expect(parseGeneratedTrackerPayload("```json\n{invalid\n```")).toBeNull();
  });

  test("formats nested state for prompt context", () => {
    const raw = JSON.stringify({
      worldData: { current_date: "2025-08-10" },
      characters: [{ name: "Alice", ap: 75, inventory: [{ name: "Potion", qty: 2 }] }],
    });
    expect(formatTrackerForPrompt(raw)).toBe(
      "- worldData:\n" +
      "  - current_date: 2025-08-10\n" +
      "- characters:\n" +
      "  - name: Alice\n" +
      "    - ap: 75\n" +
      "    - inventory:\n" +
      "      - name: Potion\n" +
      "        - qty: 2",
    );
  });
});

describe("frontend tracker normalization", () => {
  test("converts legacy character maps into a character array", () => {
    const raw = JSON.stringify({ worldData: { current_date: "2025-08-10" }, Alice: { ap: 75 }, Bob: { ap: 10 } });
    expect(parseTrackerBlock(raw)).toEqual({
      worldData: { current_date: "2025-08-10" },
      Alice: { ap: 75 },
      Bob: { ap: 10 },
      characters: [{ name: "Alice", ap: 75 }, { name: "Bob", ap: 10 }],
    });
  });

  test("keeps modern character arrays unchanged", () => {
    const modern = { worldData: {}, characters: [{ name: "Alice", ap: 75 }] };
    expect(parseTrackerBlock(JSON.stringify(modern))).toEqual(modern);
  });
});
