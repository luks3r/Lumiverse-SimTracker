import { describe, expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { setup } from "../../../src/frontend/index";

describe("frontend setup ownership", () => {
  test("overlapping setup instances update only their own settings panel", async () => {
    const originalDocument = globalThis.document;
    const originalObserver = globalThis.MutationObserver;
    const fakeDocument = {
      body: {},
      querySelectorAll: () => [],
      getElementById: () => null,
    } as unknown as Document;
    class FakeMutationObserver {
      observe() {}
      disconnect() {}
    }
    globalThis.document = fakeDocument;
    globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver;

    const makeFrontend = () => {
      const status = { textContent: "" };
      const panelRoot = {
        querySelector: (selector: string) => selector === "#sst-lumi-status" ? status : null,
      } as unknown as Element;
      let receiveBackend: ((payload: unknown) => void) | null = null;
      const ctx = {
        dom: {
          cleanup: () => {},
          addStyle: () => () => {},
          inject: () => panelRoot,
          uninject: () => {},
        },
        ui: { mount: () => ({}) },
        events: { on: () => () => {} },
        permissions: { getGranted: async () => [] },
        messages: { getLatestMessageId: () => null, registerTagInterceptor: () => () => {} },
        getActiveChat: () => null,
        onBackendMessage: (handler: (payload: unknown) => void) => {
          receiveBackend = handler;
          return () => { receiveBackend = null; };
        },
        sendToBackend: () => {},
      } as unknown as SpindleFrontendContext;
      return { ctx, status, notify: (payload: unknown) => receiveBackend?.(payload) };
    };

    const first = makeFrontend();
    const second = makeFrontend();
    let disposeFirst: (() => void) | null = null;
    let disposeSecond: (() => void) | null = null;
    try {
      disposeFirst = setup(first.ctx);
      disposeSecond = setup(second.ctx);
      await new Promise((resolve) => setTimeout(resolve, 0));
      first.notify({ type: "config_saved" });

      expect(first.status.textContent).toBe("Settings saved");
      expect(second.status.textContent).toBe("Loading config...");
    } finally {
      disposeFirst?.();
      disposeSecond?.();
      globalThis.document = originalDocument;
      globalThis.MutationObserver = originalObserver;
    }
  });
});
