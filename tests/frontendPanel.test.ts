import { describe, expect, test } from "bun:test";
import { DEFAULT_PANEL_STATUS, PANEL_CSS, PANEL_HTML } from "../src/frontendPanel";

describe("frontend panel assets", () => {
  test("keeps key controls and unique IDs", () => {
    expect(PANEL_HTML).toContain(`id="sst-lumi-status">${DEFAULT_PANEL_STATUS}</span>`);
    expect(PANEL_HTML).toContain('id="sst-lumi-llm-connection"');
    expect(PANEL_HTML).toContain('id="sst-lumi-llm-model-mount"');
    const ids = [...PANEL_HTML.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("keeps panel and tracker indicators styled", () => {
    expect(PANEL_CSS).toContain(".sst-lumi-panel {");
    expect(PANEL_CSS).toContain(".sst-tracker-generating {");
  });
});
