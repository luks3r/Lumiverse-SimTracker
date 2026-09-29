import { describe, expect, test } from "bun:test";
import {
  CONCEPTION_CONFIG,
  extractCurrentDate,
  getCharactersFromPayload,
  isAlreadyConceivedOrPregnant,
  isFemaleOrFuta,
  isInFertileWindow,
} from "../../../src/backend/conceptionRules";

describe("conception rules", () => {
  test("selects object characters and recognizes eligible sex", () => {
    const character = { name: "Alice", sex: "Female" };
    expect(getCharactersFromPayload({ characters: [character, null, 3, []] })).toEqual([character]);
    expect(isFemaleOrFuta(character)).toBe(true);
    expect(isFemaleOrFuta({ sex: "male" })).toBe(false);
  });

  test("recognizes fertile stages and early luteal cutoff", () => {
    expect(isInFertileWindow({ cycle_stage_id: 3 })).toBe(true);
    expect(isInFertileWindow({ cycle_stage: "RUT" })).toBe(true);
    expect(isInFertileWindow({ cycle_stage_id: 4, cycle_day: CONCEPTION_CONFIG.earlyLutealMaxDay })).toBe(true);
    expect(isInFertileWindow({ cycle_stage_id: 4, cycle_day: CONCEPTION_CONFIG.earlyLutealMaxDay + 1 })).toBe(false);
  });

  test("uses exact conception flags and tracker date", () => {
    expect(isAlreadyConceivedOrPregnant({ preg: true })).toBe(true);
    expect(isAlreadyConceivedOrPregnant({ conception_date: "2026-01-01" })).toBe(false);
    expect(extractCurrentDate({ worldData: { current_date: " 2026-01-01 " } })).toBe("2026-01-01");
  });
});
