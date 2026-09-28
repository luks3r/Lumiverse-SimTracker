import { beforeAll, describe, expect, test } from "bun:test";

type ChatMessage = { id: string; role: "system" | "user" | "assistant"; content: string };
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
    updateMessage: async (chatId: string, messageId: string, change: { content: string }) => {
      const target = chats.get(chatId)?.find((message) => message.id === messageId);
      if (target) target.content = change.content;
    },
  },
};

beforeAll(async () => {
  (globalThis as { spindle?: unknown }).spindle = spindle;
  await import("../src/backend.ts?backend-flows");
});

async function sendFrontend(message: FrontendMessage) {
  if (!frontendHandler) throw new Error("Frontend handler missing");
  notifications.length = 0;
  await frontendHandler(message, "flow-user");
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
});
