import { beforeAll, describe, expect, test } from "bun:test";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  swipes: string[];
  swipe_id: number;
  swipe_dates: number[];
  extra: Record<string, unknown>;
};

type GenerationRequest = {
  provider?: string;
  model?: string;
  parameters?: Record<string, unknown>;
  messages: Array<{ role: string; content: string }>;
};

const handlers = new Map<string, (payload: unknown, userId?: string) => void>();
const chats = new Map<string, Message[]>();
const requests: GenerationRequest[] = [];
const outputs: string[] = [];
const updates: Array<{ chatId: string; messageId: string; content: string }> = [];
const notifications: Array<Record<string, unknown>> = [];
let terminalNotification: ((message: Record<string, unknown>) => void) | null = null;
let connectionModel = "gpt-test";
let connectionProvider = "openai";
let trackerFormat: "json" | "yaml" = "json";

const spindle = {
  frontendCapabilities: { declare: () => () => {} },
  log: { info: () => {}, warn: () => {}, error: () => {} },
  on: (event: string, handler: (payload: unknown, userId?: string) => void) => { handlers.set(event, handler); },
  onFrontendMessage: () => {},
  registerMacro: () => {},
  updateMacroValue: () => {},
  sendToFrontend: (message: Record<string, unknown>) => {
    notifications.push(message);
    if (message.type === "secondary_generation_complete" || message.type === "secondary_generation_error") {
      terminalNotification?.(message);
    }
  },
  permissions: {
    getGranted: async () => ["generation", "generation_parameters", "chat_mutation"],
    onChanged: () => {},
    onDenied: () => {},
  },
  userStorage: {
    getJson: async () => ({
      useSecondaryLLM: true,
      secondaryLLMConnectionId: "conn-1",
      secondaryLLMModel: "",
      retainTrackerCount: 0,
      trackerFormat,
      typeSafeEnabled: false,
    }),
  },
  enclave: { get: async () => "" },
  connections: {
    list: async () => [{ id: "conn-1", provider: connectionProvider, model: connectionModel, is_default: true }],
  },
  chat: {
    getMessages: async (chatId: string) => chats.get(chatId) ?? [],
    updateMessage: async (chatId: string, messageId: string, change: { content: string }) => {
      updates.push({ chatId, messageId, content: change.content });
      const message = chats.get(chatId)?.find((item) => item.id === messageId);
      if (message) message.content = change.content;
    },
  },
  generate: {
    raw: async (request: GenerationRequest) => {
      requests.push(request);
      if (!request.provider) throw new Error(`Unknown provider: ${request.provider ?? ""}`);
      const content = outputs.shift();
      if (content === undefined) throw new Error("No mock generation output queued");
      return { content, finish_reason: "stop" };
    },
  },
};

beforeAll(async () => {
  (globalThis as { spindle?: unknown }).spindle = spindle;
  await import("../src/backend");
});

let nextChatId = 0;

async function runGeneration(
  responseTexts: string[],
  options: { initialContent?: string; connectionModel?: string; connectionProvider?: string; trackerFormat?: "json" | "yaml" } = {},
) {
  const chatId = `flow-test-${++nextChatId}`;
  const userId = `user-${nextChatId}`;
  const messageId = "assistant-1";
  const initialContent = options.initialContent ?? "Narrative beat";
  connectionModel = options.connectionModel ?? "gpt-test";
  connectionProvider = options.connectionProvider ?? "openai";
  trackerFormat = options.trackerFormat ?? "json";
  const message: Message = {
    id: messageId,
    role: "assistant",
    content: initialContent,
    swipes: [initialContent],
    swipe_id: 0,
    swipe_dates: [],
    extra: {},
  };
  chats.set(chatId, [message]);
  outputs.splice(0, outputs.length, ...responseTexts);
  requests.length = 0;
  updates.length = 0;
  notifications.length = 0;

  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Secondary generation did not finish")), 2_000);
    terminalNotification = (notification) => {
      clearTimeout(timeout);
      terminalNotification = null;
      resolve(notification);
    };
    handlers.get("GENERATION_ENDED")?.({ chatId, messageId }, userId);
  });
  return { result, message };
}

describe("secondary generation flow", () => {
  test("uses selected connection model and appends valid output", async () => {
    const { result, message } = await runGeneration(['{"worldData":{},"characters":[{"name":"Alice","ap":75}]}']);

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("gpt-test");
    expect(requests[0].provider).toBe("openai");
    expect(requests[0].parameters?.model).toBe("gpt-test");
    expect(updates).toHaveLength(1);
    expect(message.content).toContain('<tracker type="sim">');
    expect(message.content).toContain('"ap": 75');
  });

  test("repairs invalid output once, then appends corrected tracker", async () => {
    const broken = '{"worldData":{},"characters":[{"name":"Alice","ap":75}';
    const { result, message } = await runGeneration([
      broken,
      '{"worldData":{},"characters":[{"name":"Alice","ap":75}]}',
    ]);

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[0].role).toBe("system");
    expect(requests[1].messages[1].content).toBe(broken);
    expect(updates).toHaveLength(1);
    expect(message.content).toContain('"ap": 75');
  });

  test("does not mutate chat when repair remains invalid", async () => {
    const { result, message } = await runGeneration(["{invalid", "still invalid"]);

    expect(result.type).toBe("secondary_generation_error");
    expect(result.message).toBe("LLM response was not valid tracker data after one repair attempt");
    expect(requests).toHaveLength(2);
    expect(updates).toHaveLength(0);
    expect(message.content).toBe("Narrative beat");
  });

  test("does not call provider when selected connection lacks a model", async () => {
    const { result, message } = await runGeneration([], { connectionModel: "" });

    expect(result.type).toBe("secondary_generation_error");
    expect(result.message).toContain("no usable default model");
    expect(requests).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(message.content).toBe("Narrative beat");
  });

  test("does not call provider when selected connection lacks a provider", async () => {
    const { result } = await runGeneration([], { connectionProvider: "" });

    expect(result.type).toBe("secondary_generation_error");
    expect(result.message).toContain("no usable provider");
    expect(requests).toHaveLength(0);
  });

  test("parses YAML output and appends tracker in YAML format", async () => {
    const { result, message } = await runGeneration(
      ["worldData:\n  current_date: 2025-08-10\ncharacters:\n  - name: Alice\n    ap: 75"],
      { trackerFormat: "yaml" },
    );

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests).toHaveLength(1);
    expect(message.content).toContain('worldData:\n  current_date: 2025-08-10');
    expect(message.content).toContain('  - name: Alice');
  });
});
