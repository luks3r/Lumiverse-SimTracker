import { describe, expect, test } from "bun:test";
import { inferExampleValue, setDeep } from "../src/trackerExample";

describe("tracker example helpers", () => {
  test("writes nested fields and replaces scalar parents", () => {
    const value: Record<string, unknown> = { character: "old" };
    setDeep(value, " character . stats . hp ", 5);
    expect(value).toEqual({ character: { stats: { hp: 5 } } });
    setDeep(value, "...", 7);
    expect(value).toEqual({ character: { stats: { hp: 5 } } });
  });

  test("preserves example type and special value selection", () => {
    expect(inferExampleValue("name", "[number]")).toBe("Character Name");
    expect(inferExampleValue("current_date", "[number]")).toBe("YYYY-MM-DD");
    expect(inferExampleValue("last_react", "0=none, 1=like")).toBe(0);
    expect(inferExampleValue("days_preg", "")).toBe(0);
    expect(inferExampleValue("preg", "")).toBe(false);
    expect(inferExampleValue("connections", "[array]")).toEqual([{ name: "Target", affinity: 0 }]);
    expect(inferExampleValue("note", "[string]")).toBe("");
  });
});
