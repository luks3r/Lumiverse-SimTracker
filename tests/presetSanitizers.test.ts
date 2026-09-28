import { describe, expect, test } from "bun:test";
import { sanitizeInlinePacks, sanitizePresetArray, sanitizeSinglePreset } from "../src/presetSanitizers";

describe("preset sanitizers", () => {
  test("normalizes imported preset fields and generated IDs", () => {
    expect(sanitizePresetArray(null)).toEqual([]);
    const presets = sanitizePresetArray([null, { templateName: "Custom", customFields: [{ key: "hp", description: "Health" }] }]);
    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe("user-preset-0");
    expect(presets[0].templateName).toBe("Custom");
    expect(presets[0].templateAuthor).toBe("User");
    expect(presets[0].customFields).toEqual([{ key: "hp", description: "Health" }]);
  });

  test("upgrades known legacy Narrative Weave copies", () => {
    const [preset] = sanitizePresetArray([{
      id: "imported-copy",
      templateName: "Narrative Weave SimTracker",
      htmlTemplate: "nw-turn-updates nw-delta-segment",
    }]);
    expect(preset.id).toBe("imported-copy");
    expect(preset.htmlTemplate).toContain("nw-attire");
  });

  test("normalizes seeded presets and inline packs", () => {
    expect(sanitizeSinglePreset(null, "seeded")).toBeNull();
    expect(sanitizeSinglePreset({ htmlTemplate: "<div></div>" }, "seeded")).toMatchObject({
      id: "seeded",
      templateName: "seeded",
      templateAuthor: "Seeded",
    });
    expect(sanitizeInlinePacks([null, "bad", { name: "Pack" }])).toEqual([{ name: "Pack" }]);
  });
});
