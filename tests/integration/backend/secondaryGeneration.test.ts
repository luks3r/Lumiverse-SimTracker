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
  connection_id?: string;
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
const macroResolutions: Array<{ template: string; options: Record<string, unknown> }> = [];
let terminalNotification: ((message: Record<string, unknown>) => void) | null = null;
let connectionModel = "gpt-test";
let connectionProvider = "openai";
let selectedConnectionId = "conn-1";
let selectedModelOverride = "";
let trackerFormat: "json" | "yaml" = "json";
let jsonResponseFormat = false;
let retainTrackerCount = 0;
let presetPrompt: string | null = null;
let frontendHandler: ((payload: unknown, userId: string) => Promise<void>) | null = null;
let generationGate: Promise<void> | null = null;

const spindle = {
  frontendCapabilities: { declare: () => () => {} },
  log: { info: () => {}, warn: () => {}, error: () => {} },
  on: (event: string, handler: (payload: unknown, userId?: string) => void) => { handlers.set(event, handler); },
  onFrontendMessage: (handler: typeof frontendHandler) => { frontendHandler = handler; },
  registerMacro: () => {},
  updateMacroValue: () => {},
  macros: {
    resolve: async (template: string, options: Record<string, unknown>) => {
      macroResolutions.push({ template, options });
      const values: Record<string, string> = {
        char: "Ayla",
        user: "Reader",
        description: "Tall elf",
        charDescription: "Tall elf",
        personality: "Patient",
        charPersonality: "Patient",
        scenario: "Forest camp",
      };
      return { text: template.replace(/\{\{(char|user|description|charDescription|personality|charPersonality|scenario)\}\}/g, (_match, key: string) => values[key]), diagnostics: [] };
    },
  },
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
      secondaryLLMConnectionId: selectedConnectionId,
      secondaryLLMModel: selectedModelOverride,
      retainTrackerCount,
      trackerFormat,
      secondaryLLMJsonResponseFormat: jsonResponseFormat,
      ...(presetPrompt === null ? {} : {
        templateId: "context-test-preset",
        userPresets: [{ id: "context-test-preset", templateName: "Context test", sysPrompt: presetPrompt }],
      }),
      typeSafeEnabled: false,
    }),
  },
  storage: { exists: async () => false },
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
      if (generationGate) await generationGate;
      if (!request.provider) throw new Error(`Unknown provider: ${request.provider ?? ""}`);
      if (!request.connection_id) throw new Error("No API key provided. Pass api_key or connection_id in the request.");
      const content = outputs.shift();
      if (content === undefined) throw new Error("No mock generation output queued");
      return { content, finish_reason: "stop" };
    },
  },
};

beforeAll(async () => {
  (globalThis as { spindle?: unknown }).spindle = spindle;
  await import("../../../src/backend");
});

let nextChatId = 0;

async function runGeneration(
  responseTexts: string[],
  options: { initialContent?: string; connectionModel?: string; connectionProvider?: string; selectedConnectionId?: string; selectedModelOverride?: string; trackerFormat?: "json" | "yaml"; jsonResponseFormat?: boolean; priorTracker?: string; priorTrackers?: string[]; retainTrackerCount?: number; sysPrompt?: string } = {},
) {
  const chatId = `flow-test-${++nextChatId}`;
  const userId = `user-${nextChatId}`;
  const messageId = "assistant-1";
  const initialContent = options.initialContent ?? "Narrative beat";
  connectionModel = options.connectionModel ?? "gpt-test";
  connectionProvider = options.connectionProvider ?? "openai";
  selectedConnectionId = options.selectedConnectionId ?? "conn-1";
  selectedModelOverride = options.selectedModelOverride ?? "";
  trackerFormat = options.trackerFormat ?? "json";
  jsonResponseFormat = options.jsonResponseFormat ?? false;
  retainTrackerCount = options.retainTrackerCount ?? 0;
  presetPrompt = options.sysPrompt ?? null;
  const message: Message = {
    id: messageId,
    role: "assistant",
    content: initialContent,
    swipes: [initialContent],
    swipe_id: 0,
    swipe_dates: [],
    extra: {},
  };
  const priorTrackers = options.priorTrackers ?? (options.priorTracker ? [options.priorTracker] : []);
  const priorMessages: Message[] = priorTrackers.map((tracker, index) => {
    const content = `<tracker type="sim">${tracker}</tracker>`;
    return { id: `assistant-prior-${index}`, role: "assistant", content, swipes: [content], swipe_id: 0, swipe_dates: [], extra: {} };
  });
  chats.set(chatId, [...priorMessages, message]);
  outputs.splice(0, outputs.length, ...responseTexts);
  requests.length = 0;
  updates.length = 0;
  notifications.length = 0;
  macroResolutions.length = 0;

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
  test("queued jobs keep the model selected when they were requested", async () => {
    if (!frontendHandler) throw new Error("Frontend handler missing");
    const send = frontendHandler;
    const userId = "queued-user";
    const payload = '{"worldData":{},"characters":[]}';
    const first = { id: "queued-first", role: "assistant" as const, content: "First beat", swipes: [], swipe_id: 0, swipe_dates: [], extra: {} };
    const second = { id: "queued-second", role: "assistant" as const, content: "Second beat", swipes: [], swipe_id: 0, swipe_dates: [], extra: {} };
    chats.set("queued-chat-1", [first]);
    chats.set("queued-chat-2", [second]);
    requests.length = 0;
    notifications.length = 0;
    outputs.splice(0, outputs.length, payload, payload);
    selectedConnectionId = "conn-1";
    connectionProvider = "openai";
    connectionModel = "connection-default";
    selectedModelOverride = "model-A";
    trackerFormat = "json";
    jsonResponseFormat = false;
    retainTrackerCount = 0;
    presetPrompt = null;
    await send({ type: "get_config" }, userId);

    let releaseGeneration!: () => void;
    generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    try {
      await send({ type: "trigger_secondary_generation", chatId: "queued-chat-1", messageId: first.id }, userId);
      for (let attempt = 0; attempt < 100 && requests.length < 1; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(requests).toHaveLength(1);

      await send({ type: "trigger_secondary_generation", chatId: "queued-chat-2", messageId: second.id }, userId);
      selectedModelOverride = "model-B";
      await send({ type: "get_config" }, userId);
      releaseGeneration();
      for (let attempt = 0; attempt < 100 && requests.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(requests.map((request) => request.model)).toEqual(["model-A", "model-A"]);
      for (let attempt = 0; attempt < 100 && notifications.filter((message) => message.type === "secondary_generation_complete").length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(notifications.filter((message) => message.type === "secondary_generation_complete")).toHaveLength(2);
    } finally {
      releaseGeneration();
      generationGate = null;
    }
  });

  test("uses selected connection model and appends valid output", async () => {
    const { result, message } = await runGeneration(['{"worldData":{},"characters":[{"name":"Alice","ap":75}]}']);

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("gpt-test");
    expect(requests[0].provider).toBe("openai");
    expect(requests[0].connection_id).toBe("conn-1");
    expect(requests[0].parameters?.model).toBe("gpt-test");
    expect(requests[0].parameters?.response_format).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(message.content).toContain('<tracker type="sim">');
    expect(message.content).toContain('"ap": 75');
  });

  test("JSON response format can be enabled for secondary generation", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], { jsonResponseFormat: true });

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests[0].parameters?.response_format).toEqual({ type: "json_object" });
  });

  test("custom providers can opt into JSON response format", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      connectionProvider: "custom-provider",
      jsonResponseFormat: true,
    });

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests[0].provider).toBe("custom-provider");
    expect(requests[0].parameters?.response_format).toEqual({ type: "json_object" });
  });

  test("YAML generation never sends JSON response format even if the setting is enabled", async () => {
    const { result, message } = await runGeneration(
      ["worldData:\n  current_date: 2025-08-10\ncharacters:\n  - name: Alice"],
      { trackerFormat: "yaml", jsonResponseFormat: true },
    );

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests[0].parameters?.response_format).toBeUndefined();
    expect(message.content).toContain("worldData:\n  current_date: 2025-08-10");
  });

  test("passes default connection id to generation", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], { selectedConnectionId: "" });

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests[0].connection_id).toBe("conn-1");
  });

  test("explicit model override wins over the connection default", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      connectionModel: "connection-default",
      selectedModelOverride: "  custom-model  ",
    });
    expect(result.type).toBe("secondary_generation_complete");
    expect(requests[0].model).toBe("custom-model");
    expect(requests[0].parameters?.model).toBe("custom-model");
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

  test("JSON response format remains set on a syntax repair request", async () => {
    const { result } = await runGeneration(["{invalid", '{"worldData":{},"characters":[]}'], { jsonResponseFormat: true });

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests[1].parameters?.response_format).toEqual({ type: "json_object" });
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

  test("provider prompt includes prior tracker state but strips tracker markup from conversation", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      priorTracker: '{"worldData":{"turn":1},"characters":[]}',
      retainTrackerCount: 1,
    });
    expect(result.type).toBe("secondary_generation_complete");
    const prompt = requests[0].messages[0].content;
    expect(prompt).toContain("Previous tracker state:");
    expect(prompt).toContain("turn: 1");
    expect(prompt).toContain("Narrative beat");
    expect(prompt.split("Recent conversation:\n\n")[1]).not.toContain('<tracker type="sim">');
  });

  test("initial secondary tracker resolves conditional character-card context", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      sysPrompt: "Track {{char}} for {{user}}.\n{{sim_character_context}}\n{{sim_format}}",
    });

    expect(result.type).toBe("secondary_generation_complete");
    const prompt = requests[0].messages[0].content;
    expect(prompt).toContain("Track Ayla for Reader.");
    expect(prompt).toContain("Name: Ayla");
    expect(prompt).toContain("Description: Tall elf");
    expect(prompt).toContain("Personality: Patient");
    expect(prompt).toContain("Scenario: Forest camp");
    expect(prompt).not.toContain("{{sim_character_context}}");
    expect(macroResolutions[0].options).toMatchObject({ chatId: expect.any(String), commit: false });
  });

  test("retained tracker replaces repeated card context as the baseline", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      sysPrompt: "Track {{char}}.\n{{sim_character_context}}",
      priorTracker: '{"worldData":{},"characters":[{"name":"Ayla","ap":70}]}',
      retainTrackerCount: 1,
    });

    expect(result.type).toBe("secondary_generation_complete");
    const prompt = requests[0].messages[0].content;
    expect(prompt).toContain("Track Ayla.");
    expect(prompt).toContain("Previous tracker state:");
    expect(prompt).toContain("ap: 70");
    expect(prompt).not.toContain("Description: Tall elf");
    expect(prompt).not.toContain("Personality: Patient");
    expect(prompt).not.toContain("Scenario: Forest camp");
    expect(prompt).toContain("Stable baseline traits already present in the previous tracker are authoritative.");
  });

  test("without a retained baseline the character context is included again", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      sysPrompt: "{{sim_character_context}}",
      priorTracker: '{"worldData":{},"characters":[{"name":"Ayla","ap":70}]}',
      retainTrackerCount: 0,
    });

    expect(result.type).toBe("secondary_generation_complete");
    const prompt = requests[0].messages[0].content;
    expect(prompt).toContain("Description: Tall elf");
    expect(prompt).not.toContain("Previous tracker state:");
  });

  test("explicit character macros in the preset remain opt-in every turn", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      sysPrompt: "Always read {{description}}.",
      priorTracker: '{"worldData":{},"characters":[{"name":"Ayla"}]}',
      retainTrackerCount: 1,
    });

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests[0].messages[0].content).toContain("Always read Tall elf.");
  });

  test("character description and personality aliases resolve in secondary presets", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      sysPrompt: "Card: {{charDescription}}; {{charPersonality}}.",
    });

    expect(result.type).toBe("secondary_generation_complete");
    expect(requests[0].messages[0].content).toContain("Card: Tall elf; Patient.");
    expect(macroResolutions[0].template).toContain("{{description}}");
    expect(macroResolutions[0].template).toContain("{{personality}}");
  });

  test("provider prompt orders multiple retained states oldest to newest", async () => {
    const { result } = await runGeneration(['{"worldData":{},"characters":[]}'], {
      priorTrackers: ['{"worldData":{"turn":1},"characters":[]}', '{"worldData":{"turn":2},"characters":[]}'],
      retainTrackerCount: 2,
    });
    expect(result.type).toBe("secondary_generation_complete");
    const prompt = requests[0].messages[0].content;
    expect(prompt).toContain("Previous tracker states (oldest → most recent, 2 shown)");
    expect(prompt.indexOf("--- 1 turn ago ---")).toBeLessThan(prompt.indexOf("--- Most recent ---"));
    expect(prompt.indexOf("turn: 1")).toBeLessThan(prompt.indexOf("turn: 2"));
  });
});
