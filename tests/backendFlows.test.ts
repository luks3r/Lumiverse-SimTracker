import { beforeAll, describe, expect, test } from "bun:test";

type ChatMessage = { id: string; role: "system" | "user" | "assistant"; content: string; swipes?: string[]; swipe_id?: number };
type FrontendMessage = Record<string, unknown>;

const handlers = new Map<string, (payload: unknown, userId?: string) => void>();
const chats = new Map<string, ChatMessage[]>();
const notifications: FrontendMessage[] = [];
const saved: FrontendMessage[] = [];
let frontendHandler: ((payload: unknown, userId: string) => Promise<void>) | null = null;
let interceptor: ((messages: Array<Record<string, unknown>>, context: unknown) => Promise<Array<Record<string, unknown>>>) | null = null;
let permissionChanged: ((payload: { permission: string; granted: boolean; allGranted: string[] }) => void) | null = null;
let storedConfig: FrontendMessage = {};

const spindle = {
  frontendCapabilities: { declare: () => () => {} },
  log: { info: () => {}, warn: () => {}, error: () => {} },
  on: (event: string, handler: (payload: unknown, userId?: string) => void) => { handlers.set(event, handler); },
  onFrontendMessage: (handler: (payload: unknown, userId: string) => Promise<void>) => { frontendHandler = handler; },
  registerInterceptor: (handler: typeof interceptor) => { interceptor = handler; },
  registerMacro: () => {},
  updateMacroValue: () => {},
  sendToFrontend: (message: FrontendMessage) => { notifications.push(message); },
  manifest: { permissions: [] },
  permissions: {
    getGranted: async () => ["generation", "generation_parameters", "chat_mutation"],
    onChanged: (handler: typeof permissionChanged) => { permissionChanged = handler; },
    onDenied: () => {},
  },
  userStorage: {
    getJson: async (_path: string, options: { fallback: FrontendMessage }) => ({ ...options.fallback, ...storedConfig }),
    setJson: async (_path: string, value: FrontendMessage) => { saved.push(value); storedConfig = value; },
  },
  storage: { exists: async () => false },
  enclave: { get: async () => "", put: async () => {}, delete: async () => {} },
  connections: { list: async () => [] },
  chat: {
    getMessages: async (chatId: string) => chats.get(chatId) ?? [],
    updateMessage: async (chatId: string, messageId: string, change: { content?: string; swipes?: string[] }) => {
      const target = chats.get(chatId)?.find((message) => message.id === messageId);
      if (target && change.content !== undefined) target.content = change.content;
      if (target && change.swipes !== undefined) target.swipes = change.swipes;
    },
  },
};

beforeAll(async () => {
  (globalThis as { spindle?: unknown }).spindle = spindle;
  await import("../src/backend.ts?backend-flows");
});

async function sendFrontend(message: FrontendMessage, userId = "flow-user") {
  if (!frontendHandler) throw new Error("Frontend handler missing");
  notifications.length = 0;
  await frontendHandler(message, userId);
  return notifications;
}

async function waitForNotification(type: string): Promise<FrontendMessage> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = notifications.find((message) => message.type === type);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`No ${type} notification`);
}

describe("backend host flows", () => {
  test("saved settings normalize on load without restoring a plaintext API key", async () => {
    storedConfig = {
      trackerTagName: " Custom Tag! ",
      codeBlockIdentifier: " Tracker ID! ",
      retainTrackerCount: -4,
      trackerFormat: "unsupported",
      secondaryLLMModel: "model",
      typeSafeApiKey: "plaintext-old-key",
    };
    const loaded = await sendFrontend({ type: "get_config" }, "legacy-config-user");
    const config = loaded.find((message) => message.type === "config")?.config as FrontendMessage;
    expect(config).toMatchObject({
      trackerTagName: "customtag",
      codeBlockIdentifier: "trackerid",
      retainTrackerCount: 0,
      trackerFormat: "json",
      secondaryLLMModel: "",
      typeSafeApiKey: "",
    });
  });

  test("settings load and save preserve normalized values without storing TypeSafe key", async () => {
    storedConfig = {};
    const initial = await sendFrontend({ type: "get_config" });
    expect(initial.find((message) => message.type === "tag_interceptor_config")).toMatchObject({ tagName: "tracker", tagType: "sim" });
    const updated = await sendFrontend({ type: "set_config", config: {
      trackerTagName: " My Tracker! ",
      retainTrackerCount: 50,
      secondaryLLMModel: "string",
      typeSafeApiKey: "secret",
    } });
    const config = updated.find((message) => message.type === "config")?.config as FrontendMessage;
    expect(config.trackerTagName).toBe("mytracker");
    expect(config.retainTrackerCount).toBe(20);
    expect(config.secondaryLLMModel).toBe("");
    expect(saved.at(-1)?.typeSafeApiKey).toBe("");
    expect(updated.some((message) => message.type === "config_saved")).toBe(true);
  });

  test("preset import reports invalid JSON and adds a valid preset", async () => {
    storedConfig = {};
    await sendFrontend({ type: "get_config" });
    const invalid = await sendFrontend({ type: "import_preset_file", fileName: "bad.json", text: "{" });
    expect(invalid.find((message) => message.type === "import_result")).toMatchObject({ ok: false, message: "Import failed (invalid JSON)." });

    const imported = await sendFrontend({
      type: "import_preset_file",
      fileName: "custom.json",
      text: JSON.stringify({ templateName: "Custom", htmlTemplate: "<div>custom</div>", sysPrompt: "Track values" }),
    });
    expect(imported.find((message) => message.type === "import_result")).toMatchObject({ ok: true, message: "Imported preset: Custom" });
    const config = imported.find((message) => message.type === "config")?.config as FrontendMessage;
    expect(config.userPresets).toMatchObject([{ templateName: "Custom", htmlTemplate: "<div>custom</div>", sysPrompt: "Track values" }]);
  });

  test("inline-only import is stored as a pack, not a tracker preset", async () => {
    storedConfig = {};
    await sendFrontend({ type: "get_config" });
    const imported = await sendFrontend({
      type: "import_preset_file",
      fileName: "inline.json",
      text: JSON.stringify({ templateName: "Inline Only", inlineTemplates: [{ name: "Badge", template: "<b>{{value}}</b>" }] }),
    });
    expect(imported.find((message) => message.type === "import_result")).toMatchObject({ ok: true, message: "Imported inline pack: Inline Only" });
    const config = imported.find((message) => message.type === "config")?.config as FrontendMessage;
    expect(config.inlinePacks).toMatchObject([{ templateName: "Inline Only" }]);
    expect(config.userPresets).toEqual([]);
  });

  test("slash command converts latest tracker in chat", async () => {
    storedConfig = {};
    await sendFrontend({ type: "get_config" });
    const chatId = "command-chat";
    chats.set(chatId, [
      { id: "assistant-1", role: "assistant", content: 'Scene\n<tracker type="sim">\n{"characters":[{"name":"Alice","hp":5}]}\n</tracker>' },
      { id: "user-1", role: "user", content: "/sst-convert yaml" },
    ]);
    notifications.length = 0;
    handlers.get("MESSAGE_SENT")?.({ chatId, messageId: "user-1", content: "/sst-convert yaml" }, "flow-user");
    const result = await waitForNotification("command_result");
    expect((result.payload as FrontendMessage).ok).toBe(true);
    expect(chats.get(chatId)?.[0].content).toContain("characters:\n  - name: Alice");
  });

  test("slash add appends a starter tracker and rejects a duplicate", async () => {
    await sendFrontend({ type: "set_config", config: { trackerFormat: "json", trackerTagName: "tracker", codeBlockIdentifier: "sim" } });
    const chatId = "command-add-chat";
    chats.set(chatId, [
      { id: "assistant-1", role: "assistant", content: "Scene" },
      { id: "user-1", role: "user", content: "/sst-add" },
    ]);
    notifications.length = 0;
    handlers.get("MESSAGE_SENT")?.({ chatId, messageId: "user-1", content: "/sst-add" }, "flow-user");
    const first = await waitForNotification("command_result");
    expect(first.payload).toMatchObject({ command: "sst-add", ok: true, mode: "chat_mutation" });
    expect(chats.get(chatId)?.[0].content).toContain('<tracker type="sim">');

    notifications.length = 0;
    handlers.get("MESSAGE_SENT")?.({ chatId, messageId: "user-1", content: "/sst-add" }, "flow-user");
    const second = await waitForNotification("command_result");
    expect(second.payload).toMatchObject({ command: "sst-add", ok: false, message: "Latest assistant message already contains a tracker tag." });
  });

  test("slash regen rewrites the latest tracker in the preferred format", async () => {
    await sendFrontend({ type: "set_config", config: { trackerFormat: "yaml", trackerTagName: "tracker", codeBlockIdentifier: "sim" } });
    const chatId = "command-regen-chat";
    chats.set(chatId, [
      { id: "assistant-1", role: "assistant", content: 'Scene\n<tracker type="sim">\n{"characters":[{"name":"Bob","hp":7}]}\n</tracker>' },
      { id: "user-1", role: "user", content: "/sst-regen" },
    ]);
    notifications.length = 0;
    handlers.get("MESSAGE_SENT")?.({ chatId, messageId: "user-1", content: "/sst-regen" }, "flow-user");
    const result = await waitForNotification("command_result");
    expect(result.payload).toMatchObject({ command: "sst-regen", ok: true, mode: "chat_mutation" });
    expect(chats.get(chatId)?.[0].content).toContain("characters:\n  - name: Bob");
    expect(chats.get(chatId)?.[0].content).toContain("hp: 7");
  });

  test("latest tracker lookup rehydrates ordered history from chat messages", async () => {
    await sendFrontend({ type: "get_config" });
    const chatId = "history-hydrate-chat";
    const first = '<tracker type="sim">{"turn":1}</tracker>';
    const second = '<tracker type="sim">{"turn":2}</tracker>';
    chats.set(chatId, [
      { id: "assistant-1", role: "assistant", content: first, swipes: [first], swipe_id: 0 },
      { id: "assistant-2", role: "assistant", content: second, swipes: [second], swipe_id: 0 },
    ]);
    const notifications = await sendFrontend({ type: "get_latest_tracker", chatId });
    expect(notifications.find((message) => message.type === "tracker_history_latest")).toMatchObject({
      chatId,
      entry: { messageId: "assistant-2", payload: '{"turn":2}', previousPayload: '{"turn":1}' },
    });
  });

  test("intercepted and edited trackers update latest history", async () => {
    await sendFrontend({ type: "get_config" });
    const chatId = "history-events-chat";
    chats.set(chatId, []);
    await sendFrontend({ type: "get_latest_tracker", chatId });

    handlers.get("MESSAGE_TAG_INTERCEPTED")?.({
      chatId, messageId: "assistant-1", tagName: "tracker", attrs: { type: "sim" }, content: '{"turn":1}', isStreaming: false,
    }, "flow-user");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const recorded = await sendFrontend({ type: "get_latest_tracker", chatId });
    expect(recorded.find((message) => message.type === "tracker_history_latest")).toMatchObject({
      entry: { messageId: "assistant-1", payload: '{"turn":1}', previousPayload: null },
    });

    handlers.get("MESSAGE_EDITED")?.({ chatId, messageId: "assistant-1", content: "Tracker removed" }, "flow-user");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const removed = await sendFrontend({ type: "get_latest_tracker", chatId });
    expect(removed.find((message) => message.type === "tracker_history_latest")).toMatchObject({ chatId, entry: null });
  });

  test("latest tracker lookup migrates a legacy hidden block in content and swipes", async () => {
    await sendFrontend({ type: "get_config" });
    const chatId = "history-legacy-chat";
    const legacy = '<div style="display:none"><pre>```sim\n{"turn":4}\n```</pre></div>';
    chats.set(chatId, [{ id: "assistant-1", role: "assistant", content: legacy, swipes: [legacy], swipe_id: 0 }]);
    const notifications = await sendFrontend({ type: "get_latest_tracker", chatId });
    expect(notifications.find((message) => message.type === "tracker_history_latest")).toMatchObject({
      entry: { messageId: "assistant-1", payload: '{"turn":4}' },
    });
    expect(chats.get(chatId)?.[0].content).toBe('<tracker type="sim">\n{"turn":4}\n</tracker>');
    expect(chats.get(chatId)?.[0].swipes?.[0]).toBe('<tracker type="sim">\n{"turn":4}\n</tracker>');
  });

  test("interceptor retains newest tracker and strips older one", async () => {
    await sendFrontend({ type: "set_config", config: { retainTrackerCount: 1 } });
    permissionChanged?.({ permission: "interceptor", granted: true, allGranted: ["interceptor", "generation", "chat_mutation"] });
    if (!interceptor) throw new Error("Interceptor missing");
    chats.set("retention-chat", []);
    const output = await interceptor([
      { role: "assistant", content: '<tracker type="sim">{"turn":1}</tracker>' },
      { role: "assistant", content: '<tracker type="sim">{"turn":2}</tracker>' },
      { role: "user", content: "Continue" },
    ], { chatId: "retention-chat" });
    expect(output.map((message) => message.content).join("\n")).not.toContain("turn: 1");
    expect(output.map((message) => message.content).join("\n")).toContain("turn: 2");
  });

  test("interceptor commits a deterministic conception and injects its directive", async () => {
    await sendFrontend({ type: "set_config", config: { retainTrackerCount: 1, trackerFormat: "json" } });
    permissionChanged?.({ permission: "interceptor", granted: true, allGranted: ["interceptor", "generation", "chat_mutation"] });
    if (!interceptor) throw new Error("Interceptor missing");
    const chatId = "conception-chat";
    const payload = JSON.stringify({
      worldData: { current_date: "2026-09-28" },
      characters: [{ name: "Alice", sex: "female", cycle_stage_id: 3, womb_fullness_pct: 100, conceived: false }],
    });
    const content = `<tracker type="sim">${payload}</tracker>`;
    chats.set(chatId, [{ id: "assistant-1", role: "assistant", content, swipes: [content], swipe_id: 0 }]);

    const output = await interceptor([
      { role: "assistant", content },
      { role: "user", content: "Continue the scene" },
    ], { chatId });
    expect(output.map((message) => message.content).join("\n")).toContain("CONCEPTION DIRECTIVE: Alice has conceived.");
    const latest = await sendFrontend({ type: "get_latest_tracker", chatId });
    const entry = latest.find((message) => message.type === "tracker_history_latest")?.entry as FrontendMessage;
    expect(JSON.parse(String(entry.payload)).characters[0]).toMatchObject({ conceived: true, conception_date: "2026-09-28" });
  });
});
