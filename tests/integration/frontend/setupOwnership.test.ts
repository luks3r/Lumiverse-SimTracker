import { describe, expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { setup } from "../../../src/frontend/index";

describe("frontend setup ownership", () => {
  test("chat switch ignores old history and renders the selected chat's latest tracker after config", async () => {
    const originalDocument = globalThis.document;
    const originalObserver = globalThis.MutationObserver;
    const originalFrame = globalThis.requestAnimationFrame;
    const status = { textContent: "" };
    const panelRoot = { querySelector: (selector: string) => selector === "#sst-lumi-status" ? status : null } as unknown as Element;
    const events = new Map<string, (payload: unknown) => void>();
    const sent: unknown[] = [];
    let activeChatId = "chat-a";
    let receiveBackend: ((payload: unknown) => void) | null = null;
    let interceptTag: ((payload: { content: string; chatId: string; messageId: string; tagName: string; attrs: Record<string, string> }) => void) | null = null;
    globalThis.document = { body: {}, querySelectorAll: () => [], getElementById: () => null } as unknown as Document;
    globalThis.MutationObserver = class { observe() {} disconnect() {} } as unknown as typeof MutationObserver;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 1; }) as typeof requestAnimationFrame;
    const ctx = {
      dom: { cleanup: () => {}, addStyle: () => () => {}, inject: () => panelRoot, uninject: () => {}, findMessageElement: () => null },
      ui: { mount: () => ({}) },
      events: { on: (name: string, handler: (payload: unknown) => void) => { events.set(name, handler); return () => events.delete(name); } },
      permissions: { getGranted: async () => [] },
      messages: {
        getLatestMessageId: () => null,
        registerTagInterceptor: (_options: unknown, handler: typeof interceptTag) => { interceptTag = handler; return () => { interceptTag = null; }; },
      },
      getActiveChat: () => ({ chatId: activeChatId }),
      onBackendMessage: (handler: (payload: unknown) => void) => { receiveBackend = handler; return () => { receiveBackend = null; }; },
      sendToBackend: (message: unknown) => { sent.push(message); },
    } as unknown as SpindleFrontendContext;
    let dispose: (() => void) | null = null;
    try {
      dispose = setup(ctx);
      await Promise.resolve();
      receiveBackend?.({ type: "tag_interceptor_config", tagName: "tracker", tagType: "simtracker", removeFromMessage: true });
      activeChatId = "chat-b";
      events.get("CHAT_SWITCHED")?.({ chatId: "chat-b" });
      interceptTag?.({ content: '{"characters":[{"name":"Early"}]}', chatId: "chat-b", messageId: "early", tagName: "tracker", attrs: {} });
      receiveBackend?.({ type: "tracker_history_latest", chatId: "chat-a", entry: { messageId: "old", payload: '{"characters":[{"name":"Old"}]}', previousPayload: null } });
      expect(status.textContent).toBe("Loading config...");
      receiveBackend?.({ type: "config", config: {} });
      expect(status.textContent).toBe("Waiting for tracker tag...");
      receiveBackend?.({ type: "tracker_history_latest", chatId: "chat-b", entry: { messageId: "latest", payload: '{"characters":[{"name":"Latest"}]}', previousPayload: null } });
      expect(sent).toContainEqual({ type: "get_latest_tracker", chatId: "chat-b" });
      expect(sent.filter((message) => (message as { type?: string; chatId?: string }).type === "get_latest_tracker" && (message as { chatId?: string }).chatId === "chat-b")).toHaveLength(1);
      expect(status.textContent.startsWith("Tracker updated (")).toBe(true);
    } finally {
      dispose?.();
      globalThis.document = originalDocument;
      globalThis.MutationObserver = originalObserver;
      globalThis.requestAnimationFrame = originalFrame;
    }
  });

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
