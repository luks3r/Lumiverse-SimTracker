import { describe, expect, test } from "bun:test";
import { parseTrackerBlock } from "../../../src/shared/trackerData";

describe("tracker data normalization", () => {
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
