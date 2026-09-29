import { expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../../src/shared/trackerConfig";
import { getTemplatePresetById } from "../../../src/shared/templatePresets";
import { createTrackerHydration } from "../../../src/frontend/trackerHydration";
import { createTrackerRendering } from "../../../src/frontend/trackerRendering";
import { createTrackerRenderState } from "../../../src/frontend/trackerRenderState";

test("switching chats clears message and side mounts and forgets comparison data", () => {
  const removed: Element[] = [];
  let sideRemoved = 0;
  let buttonUpdates = 0;
  const messageMount = {} as Element;
  const indicatorMount = {} as Element;
  const state = createTrackerRenderState();
  state.previousTrackerData = { characters: [{ name: "Old" }] };
  state.latestTrackerMessageId = "old-message";
  state.latestTrackerRaw = "old payload";
  state.trackerMessageIds.add("old-message");
  state.trackerMessageMounts.set("old-message", messageMount);
  state.trackerGeneratingIndicators.set("old-message", indicatorMount);
  state.trackerComparisonBaselines.set("old-message", null);
  state.sideTrackerMount = { remove: () => { sideRemoved += 1; } } as unknown as Element;
  const ctx = { dom: { uninject: (mount: Element) => { removed.push(mount); } } } as unknown as SpindleFrontendContext;
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
    state,
    hydration,
    readConfig: () => DEFAULT_CONFIG,
    isConfigReady: () => true,
    getPresetById: (_config, id) => getTemplatePresetById(id),
    extractTrackerBlock: () => null,
    setStatus: () => {},
    renderEmpty: () => {},
    renderTracker: () => {},
    applyThemeClass: () => {},
    updateRegenerateButton: () => { buttonUpdates += 1; },
    hasPermission: () => false,
  });

  renderer.resetForChat();

  expect(removed).toEqual([messageMount, indicatorMount]);
  expect(sideRemoved).toBe(1);
  expect(buttonUpdates).toBe(1);
  expect(state.latestTrackerRaw).toBeNull();
  expect(state.latestTrackerMessageId).toBeNull();
  expect(state.trackerComparisonBaselines.size).toBe(0);
});

test("swiping clears the previous render before clearing inline content", () => {
  const actions: string[] = [];
  const mount = {} as Element;
  const state = createTrackerRenderState();
  state.latestTrackerMessageId = "old-message";
  state.latestTrackerRaw = "old payload";
  state.trackerMessageMounts.set("old-message", mount);
  const ctx = { dom: { uninject: () => { actions.push("uninject"); } } } as unknown as SpindleFrontendContext;
  const hydration = createTrackerHydration({
    getActiveChatId: () => null, sendLatestRequest: () => {}, isConfigReady: () => true,
    hasRenderedMessage: () => false, setComparisonBaseline: () => {}, renderPayload: () => {},
  });
  const renderer = createTrackerRendering({
    ctx, byId: () => null, state, hydration, readConfig: () => DEFAULT_CONFIG,
    isConfigReady: () => true, getPresetById: (_config, id) => getTemplatePresetById(id),
    extractTrackerBlock: () => null, setStatus: () => {}, renderEmpty: () => {},
    renderTracker: () => {}, applyThemeClass: () => {}, updateRegenerateButton: () => {}, hasPermission: () => false,
  });

  renderer.clearForSwipe("new-message", (messageId) => { actions.push(`inline:${messageId}`); });

  expect(actions).toEqual(["uninject", "inline:old-message", "inline:new-message"]);
  expect(state.latestTrackerRaw).toBeNull();
  expect(state.latestTrackerMessageId).toBe("old-message");
});

test("deleting the latest message removes its tracker and clears regeneration state", () => {
  const actions: string[] = [];
  const mount = {} as Element;
  const indicator = {} as Element;
  const state = createTrackerRenderState();
  state.latestTrackerMessageId = "deleted";
  state.latestTrackerRaw = "deleted payload";
  state.trackerMessageIds.add("deleted");
  state.trackerMessageMounts.set("deleted", mount);
  state.trackerGeneratingIndicators.set("deleted", indicator);
  const ctx = { dom: { uninject: (node: Element) => { actions.push(node === mount ? "tracker removed" : "indicator removed"); } } } as unknown as SpindleFrontendContext;
  const hydration = createTrackerHydration({
    getActiveChatId: () => null, sendLatestRequest: () => {}, isConfigReady: () => true,
    hasRenderedMessage: () => false, setComparisonBaseline: () => {}, renderPayload: () => {},
  });
  const renderer = createTrackerRendering({
    ctx, byId: () => null, state, hydration, readConfig: () => DEFAULT_CONFIG,
    isConfigReady: () => true, getPresetById: (_config, id) => getTemplatePresetById(id),
    extractTrackerBlock: () => null, setStatus: () => {}, renderEmpty: () => {},
    renderTracker: () => {}, applyThemeClass: () => {}, updateRegenerateButton: () => { actions.push("button updated"); }, hasPermission: () => false,
  });

  renderer.forgetMessage("deleted", (id) => { actions.push(`inline:${id}`); });

  expect(actions).toEqual(["tracker removed", "indicator removed", "inline:deleted", "button updated"]);
  expect(state.latestTrackerMessageId).toBeNull();
  expect(state.latestTrackerRaw).toBeNull();
});

test("a newly mounted latest message can attach its tracker from host content", () => {
  const statuses: string[] = [];
  const state = createTrackerRenderState();
  const ctx = { messages: { getLatestMessageId: () => "latest" } } as unknown as SpindleFrontendContext;
  const hydration = createTrackerHydration({
    getActiveChatId: () => null, sendLatestRequest: () => {}, isConfigReady: () => true,
    hasRenderedMessage: () => false, setComparisonBaseline: () => {}, renderPayload: () => {},
  });
  const renderer = createTrackerRendering({
    ctx, byId: () => null, state, hydration, readConfig: () => DEFAULT_CONFIG,
    isConfigReady: () => true, getPresetById: (_config, id) => getTemplatePresetById(id),
    extractTrackerBlock: () => "not-json-or-yaml: [",
    setStatus: (value) => { statuses.push(value); }, renderEmpty: () => {},
    renderTracker: () => {}, applyThemeClass: () => {}, updateRegenerateButton: () => {}, hasPermission: () => false,
  });

  renderer.handleMessageRendered("latest", "host content");

  expect(statuses).toEqual(["Tracker found (invalid JSON/YAML)"]);
});
