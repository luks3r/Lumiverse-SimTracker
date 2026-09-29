import type { createTrackerRendering } from "./trackerRendering";

type TrackerRenderState = Parameters<typeof createTrackerRendering>[0]["state"];

export function createTrackerRenderState(): TrackerRenderState {
  return {
    previousTrackerData: null,
    latestContent: null,
    latestTrackerMessageId: null,
    latestTrackerRaw: null,
    latestTrackerSourceContent: null,
    trackerMessageIds: new Set(),
    trackerMessageMounts: new Map(),
    trackerMessageRenders: new Map(),
    trackerComparisonBaselines: new Map(),
    trackerGeneratingIndicators: new Map(),
    latestMessageRenderIntent: null,
    pendingGeneratingIndicatorMessageId: null,
    sideTrackerMount: null,
    sideAppMount: null,
  };
}
