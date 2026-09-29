import type { SpindleAppMountHandle } from "lumiverse-spindle-types";
import type { TrackerData } from "../shared/trackerData";
import type { LatestMessageRenderIntent, TrackerRenderInputs } from "./trackerRendering";

export type TrackerRenderState = {
  previousTrackerData: TrackerData | null;
  latestContent: string | null;
  latestTrackerMessageId: string | null;
  latestTrackerRaw: string | null;
  latestTrackerSourceContent: string | null;
  trackerMessageIds: Set<string>;
  trackerMessageMounts: Map<string, Element>;
  trackerMessageRenders: Map<string, TrackerRenderInputs>;
  trackerComparisonBaselines: Map<string, TrackerData | null>;
  trackerGeneratingIndicators: Map<string, Element>;
  latestMessageRenderIntent: LatestMessageRenderIntent | null;
  pendingGeneratingIndicatorMessageId: string | null;
  sideTrackerMount: Element | null;
  sideAppMount: { mount: SpindleAppMountHandle; side: string } | null;
};

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
