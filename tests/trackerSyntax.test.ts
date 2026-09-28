import { describe, expect, test } from "bun:test";
import { buildTrackerFenceRegex, extractSimBlock, extractTrackerTag, sanitizeIdentifier, sanitizeTagName } from "../src/trackerSyntax";

describe("tracker message syntax", () => {
  test("reads matching tag type and ignores other tags", () => {
    const content = '<tracker type="other">wrong</tracker><tracker type="sim">{"turn":2}</tracker>';
    expect(extractTrackerTag(content, "tracker", "sim")).toBe('{"turn":2}');
  });

  test("reads fenced tracker without matching identifier prefix", () => {
    expect(extractSimBlock('```sim\n{"turn":2}\n```', "sim")).toBe('{"turn":2}');
    expect(buildTrackerFenceRegex("sim").test('```simple\n{"turn":2}\n```')).toBe(false);
  });

  test("sanitizes names with established defaults", () => {
    expect(sanitizeTagName(" My Tracker! ")).toBe("mytracker");
    expect(sanitizeIdentifier(null)).toBe("sim");
  });
});
