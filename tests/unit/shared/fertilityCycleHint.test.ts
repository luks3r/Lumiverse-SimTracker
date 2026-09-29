import { describe, expect, test } from "bun:test";
import { buildFirstMessageHint, type FertilityCycleBias } from "../../../src/shared/fertilityCycleHint";

describe("first-message fertility hint", () => {
  test("uses each configured cycle window", () => {
    const windows: Array<[FertilityCycleBias, number, number, string]> = [
      ["menstruating", 1, 5, "menstruating"],
      ["start_follicular", 6, 10, "early follicular"],
      ["close_ovulation", 11, 13, "approaching ovulation"],
      ["ovulating", 14, 16, "ovulating"],
      ["start_luteal", 17, 21, "early luteal"],
      ["end_luteal", 24, 28, "pre-menstrual"],
    ];
    for (const [bias, min, max, label] of windows) {
      const hint = buildFirstMessageHint(bias);
      const day = Number(hint.match(/on day (\d+)/)?.[1]);
      expect(day).toBeGreaterThanOrEqual(min);
      expect(day).toBeLessThanOrEqual(max);
      expect(hint).toContain(label);
    }
  });

  test("random bias uses full cycle and no stage description", () => {
    const hint = buildFirstMessageHint("random");
    const day = Number(hint.match(/on day (\d+)/)?.[1]);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(28);
    expect(hint).toContain("fertility cycle already. Reflect this");
  });
});
