import { describe, expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { createReadyGate } from "../src/frontendReadyGate";

describe("frontend ready gate", () => {
  test("releases once after supported host version resolves", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ backend: { version: "1.0.6" } }) })) as typeof fetch;
    try {
      let deferred = 0;
      let ready = 0;
      const gate = createReadyGate({ deferReady: () => { deferred++; }, ready: () => { ready++; } } as SpindleFrontendContext);
      expect(deferred).toBe(1);
      gate.release();
      gate.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ready).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not broadcast ready to older host", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ backend: { version: "1.0.5" } }) })) as typeof fetch;
    try {
      let ready = 0;
      const gate = createReadyGate({ deferReady: () => {}, ready: () => { ready++; } } as SpindleFrontendContext);
      gate.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ready).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("disposed gate does not broadcast ready", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    try {
      let ready = 0;
      const gate = createReadyGate({ deferReady: () => {}, ready: () => { ready++; } } as SpindleFrontendContext);
      gate.dispose();
      gate.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ready).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
