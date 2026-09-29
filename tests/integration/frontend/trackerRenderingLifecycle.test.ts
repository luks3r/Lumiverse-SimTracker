import { expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../../src/shared/trackerConfig";
import { createTrackerHydration } from "../../../src/frontend/trackerHydration";
import { createTrackerRendering } from "../../../src/frontend/trackerRendering";

const TRACKER = '{"characters":[{"name":"Alice"}]}';

function makeRenderer(options: { side?: boolean; extractTrackerBlock?: () => string | null } = {}) {
  const actions: string[] = [];
  const rendered: string[] = [];
  const messageNode = { querySelector: () => null } as unknown as Element;
  const ctx = {
    dom: {
      findMessageElement: () => messageNode,
      inject: (_parent: unknown, html: string) => {
        const kind = html.includes("sst-tracker-generating") ? "indicator" : options.side ? "side" : "tracker";
        actions.push(`inject:${kind}`);
        return {
          isConnected: true,
          querySelectorAll: () => [],
          remove: () => { actions.push(`remove:${kind}`); },
        } as unknown as Element;
      },
      uninject: () => { actions.push("uninject:mount"); },
    },
    messages: { getLatestMessageId: () => "old-message" },
    ui: { mount: () => messageNode },
  } as unknown as SpindleFrontendContext;
  const hydration = createTrackerHydration({
    getActiveChatId: () => null,
    sendLatestRequest: () => {},
    isConfigReady: () => true,
    hasRenderedMessage: () => false,
    setComparisonBaseline: () => {},
    renderPayload: () => {},
  });
  const renderer = createTrackerRendering({
    ctx,
    byId: () => null,
    hydration,
    readConfig: () => DEFAULT_CONFIG,
    isConfigReady: () => true,
    getPresetById: () => ({
      id: "test",
      templateName: "Test",
      htmlTemplate: "<div>{{name}}</div>",
      templatePosition: options.side ? "LEFT" : "BOTTOM",
    }),
    extractTrackerBlock: options.extractTrackerBlock || (() => TRACKER),
    setStatus: (value) => { actions.push(`status:${value}`); },
    renderEmpty: () => {},
    renderTracker: (_data, raw) => { rendered.push(raw); },
    applyThemeClass: () => {},
    updateRegenerateButton: () => { actions.push("button updated"); },
    hasPermission: () => false,
  });
  return { renderer, actions, rendered };
}

test("switching chats removes message and indicator mounts", () => {
  const { renderer, actions } = makeRenderer();
  renderer.handleTrackerPayload(TRACKER, TRACKER, "old-message");
  renderer.showGeneratingIndicator("old-message");
  actions.length = 0;

  renderer.resetForChat();

  expect(actions).toEqual(["button updated", "uninject:mount", "uninject:mount"]);
  expect(renderer.readLatestTrackerMessageId()).toBeNull();
  expect(renderer.hasRenderedMessage("old-message")).toBe(false);
});

test("switching chats removes a side mount", () => {
  const { renderer, actions } = makeRenderer({ side: true });
  renderer.handleTrackerPayload(TRACKER, TRACKER, "old-message");
  actions.length = 0;

  renderer.resetForChat();

  expect(actions).toContain("remove:side");
});

test("swiping clears the previous render before clearing inline content", () => {
  const { renderer, actions } = makeRenderer();
  renderer.handleTrackerPayload(TRACKER, TRACKER, "old-message");
  actions.length = 0;

  renderer.clearForSwipe("new-message", (messageId) => { actions.push(`inline:${messageId}`); });

  expect(actions).toEqual(["uninject:mount", "inline:old-message", "inline:new-message"]);
  expect(renderer.readLatestTrackerMessageId()).toBe("old-message");
});

test("deleting the latest message removes its tracker and clears regeneration state", () => {
  const { renderer, actions } = makeRenderer();
  renderer.handleTrackerPayload(TRACKER, TRACKER, "old-message");
  renderer.showGeneratingIndicator("old-message");
  actions.length = 0;

  renderer.forgetMessage("old-message", (messageId) => { actions.push(`inline:${messageId}`); });

  expect(actions).toEqual(["uninject:mount", "uninject:mount", "inline:old-message", "button updated"]);
  expect(renderer.readLatestTrackerMessageId()).toBeNull();
});

test("a newly mounted latest message can attach its tracker from host content", () => {
  const { renderer, actions } = makeRenderer({ extractTrackerBlock: () => "not-json-or-yaml: [" });

  renderer.handleMessageRendered("old-message", "host content");

  expect(actions).toContain("status:Tracker found (invalid JSON/YAML)");
});

test("reapplying a template prefers latest source content over cached raw tracker", () => {
  const { renderer, rendered } = makeRenderer({ extractTrackerBlock: () => TRACKER });
  renderer.handleContent("latest message source", null);
  renderer.handleTrackerPayload('{"characters":[{"name":"Cached"}]}', "cached", null);
  rendered.length = 0;

  renderer.reapplyLatest();

  expect(rendered).toEqual([TRACKER]);
});
