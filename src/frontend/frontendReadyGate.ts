import type { SpindleFrontendContext } from "lumiverse-spindle-types";

const READY_MIN_VERSION = [1, 0, 6] as const;

function parseVersionSegment(segment: string | undefined): number {
  if (!segment) return 0;
  const match = segment.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function isVersionAtLeast(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(".");
  for (let index = 0; index < minimum.length; index += 1) {
    const current = parseVersionSegment(parts[index]);
    const required = minimum[index];
    if (current > required) return true;
    if (current < required) return false;
  }
  return true;
}

async function shouldBroadcastReadyForHost(): Promise<boolean> {
  try {
    const response = await fetch("/api/v1/system/info", { credentials: "same-origin" });
    if (!response.ok) return true;
    const payload = await response.json() as { backend?: { version?: unknown } };
    const version = typeof payload?.backend?.version === "string" ? payload.backend.version : null;
    return version ? isVersionAtLeast(version, READY_MIN_VERSION) : true;
  } catch {
    return true;
  }
}

export function createReadyGate(ctx: SpindleFrontendContext) {
  const readyContext = ctx as SpindleFrontendContext & {
    deferReady?: () => void;
    ready?: () => void;
  };
  if (typeof readyContext.deferReady !== "function" || typeof readyContext.ready !== "function") {
    return {
      dispose() {},
      release() {},
    };
  }

  readyContext.deferReady();
  const shouldBroadcastReady = shouldBroadcastReadyForHost();
  let disposed = false;
  let released = false;

  return {
    dispose() {
      disposed = true;
    },
    release() {
      if (disposed || released) return;
      released = true;
      void shouldBroadcastReady.then((allowed) => {
        if (!disposed && allowed) {
          readyContext.ready?.();
        }
      });
    },
  };
}
