import { describe, expect, test } from "bun:test";
import { adjustColorBrightness, adjustHslColor, darkenColor, normalizeHexColor } from "../../../src/frontend/colorUtils";

describe("tracker colors", () => {
  test("normalizes short and long hex values and applies fallback", () => {
    expect(normalizeHexColor(" abc ")).toBe("#aabbcc");
    expect(normalizeHexColor("#12AB34")).toBe("#12AB34");
    expect(normalizeHexColor("not a color")).toBe("#6a5acd");
  });

  test("keeps established brightness and darkening behavior", () => {
    expect(darkenColor("#123456")).toBe("#002042");
    expect(adjustColorBrightness("#808080", 50)).toBe("#404040");
    expect(adjustColorBrightness("#808080", 150)).toBe("#808080");
  });

  test("keeps HSL identity and hue rotation", () => {
    expect(adjustHslColor("#ff0000", 0, 0, 0)).toBe("#ff0000");
    expect(adjustHslColor("#ff0000", 120, 0, 0)).toBe("#00ff00");
  });
});
