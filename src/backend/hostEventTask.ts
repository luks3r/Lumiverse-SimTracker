import type { SpindleAPI } from "lumiverse-spindle-types";

export function runHostEventTask(spindle: SpindleAPI, eventName: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    spindle.log.error(`${eventName} handler failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}
