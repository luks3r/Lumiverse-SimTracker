import { describe, expect, test } from "bun:test";
import { buildTrackerMarkup } from "../src/frontend/frontendTemplateRenderer";

describe("frontend template rendering", () => {
  test("renders per-character cards with prior numeric changes", () => {
    const preset = { id: "render-cards", templateName: "Cards", htmlTemplate: "{{name}}:{{stats.hp}}:{{stats.hpChange}};" };
    const data = { characters: [{ name: "Alice", hp: 5 }, { name: "Bob", hp: 7 }] };
    const previous = { characters: [{ name: "Alice", hp: 3 }] };
    const result = buildTrackerMarkup(data, preset, previous);
    expect(result.html).toContain("Alice:5:2;Bob:7:;");
    expect(JSON.parse(result.fallbackRaw)).toEqual(data);
  });

  test("renders tracker-level template once for all characters", () => {
    const preset = {
      id: "render-tracker",
      templateName: "Tracker",
      htmlTemplate: "{{#each characters}}{{name}};{{/each}}",
      extSettings: { renderMode: "tracker" },
    };
    const result = buildTrackerMarkup({ characters: [{ name: "Alice" }, { name: "Bob" }] }, preset, null);
    expect(result.html).toContain("Alice;Bob;");
  });

  test("keeps raw fallback when template is empty", () => {
    const result = buildTrackerMarkup({ characters: [] }, { id: "empty", templateName: "Empty" }, null);
    expect(result.html).toBeNull();
    expect(result.fallbackRaw).toContain('"characters": []');
  });
});
