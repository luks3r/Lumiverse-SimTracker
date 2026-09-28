import { describe, expect, test } from "bun:test";
import { calculateStatChanges, normalizeCharacters } from "../src/trackerViewData";

describe("tracker view data", () => {
  test("keeps modern characters and converts legacy maps", () => {
    const characters = [{ name: "A", hp: 4 }];
    expect(normalizeCharacters({ characters })).toBe(characters);
    expect(normalizeCharacters({ worldData: { turn: 1 }, A: { hp: 4 }, count: 2 })).toEqual(characters);
  });

  test("calculates nested numeric changes using previous paths", () => {
    const previous = { characters: [{ name: "A", hp: 4, stats: { ap: 3, label: "old" }, gone: 2 }] };
    const current = [{ name: "A", hp: 7, stats: { ap: 1 }, added: 9 }, { name: "B", hp: 2 }];
    expect(calculateStatChanges(current, previous)).toEqual({ A: { hpChange: 3, "stats.apChange": -2 }, B: {} });
  });

  test("returns empty changes without previous data", () => {
    expect(calculateStatChanges([{ name: "A", hp: 1 }], null)).toEqual({ A: {} });
  });
});
