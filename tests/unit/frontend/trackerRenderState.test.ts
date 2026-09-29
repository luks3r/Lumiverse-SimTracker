import { expect, test } from "bun:test";
import { createTrackerRenderState } from "../../../src/frontend/trackerRenderState";

test("render state is isolated per frontend setup", () => {
  const first = createTrackerRenderState();
  const second = createTrackerRenderState();
  first.trackerMessageIds.add("message-a");
  first.latestTrackerRaw = "old";
  expect(second.trackerMessageIds.size).toBe(0);
  expect(second.latestTrackerRaw).toBeNull();
});
