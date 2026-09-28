import { expect, test } from "bun:test";

test("settings include valid seeded presets discovered in nested template folders", async () => {
  const notifications: Array<Record<string, unknown>> = [];
  let frontendHandler: ((payload: unknown, userId: string) => Promise<void>) | null = null;
  const files: Record<string, Record<string, unknown>> = {
    "templates/scene/Example Preset.json": {
      templateName: "Nested Example",
      htmlTemplate: "<section>Example</section>",
      sysPrompt: "Track the scene",
    },
    "templates/empty.json": { templateName: "Empty", htmlTemplate: "" },
  };
  const spindle = {
    frontendCapabilities: { declare: () => () => {} },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    on: () => {},
    onFrontendMessage: (handler: typeof frontendHandler) => { frontendHandler = handler; },
    registerInterceptor: () => {},
    registerMacro: () => {},
    updateMacroValue: () => {},
    sendToFrontend: (message: Record<string, unknown>) => { notifications.push(message); },
    manifest: { permissions: [] },
    permissions: { getGranted: async () => [], onChanged: () => {}, onDenied: () => {} },
    userStorage: { getJson: async (_path: string, options: { fallback: unknown }) => options.fallback },
    enclave: { get: async () => "" },
    storage: {
      exists: async (path: string) => path === "templates",
      list: async (path: string) => path === "templates" ? ["scene", "empty.json"] : ["Example Preset.json"],
      stat: async (path: string) => ({ exists: path === "templates/scene" || path in files, isDirectory: path === "templates/scene", isFile: path in files }),
      getJson: async (path: string) => files[path],
    },
  };
  (globalThis as { spindle?: unknown }).spindle = spindle;
  await import("../src/backend/index.ts?seeded-presets-flow");
  if (!frontendHandler) throw new Error("Frontend handler missing");
  await frontendHandler({ type: "get_config" }, "seeded-user");

  const configMessage = notifications.find((message) => message.type === "config");
  expect(configMessage?.seededPresets).toMatchObject([
    { id: "example-preset", templateName: "Nested Example", htmlTemplate: "<section>Example</section>" },
  ]);
});
