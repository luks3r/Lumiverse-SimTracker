import { expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { registerSettingsActions } from "../../../src/frontend/settingsActions";
import { DEFAULT_CONFIG } from "../../../src/shared/trackerConfig";
import { getTemplatePresetById } from "../../../src/shared/templatePresets";

test("secondary regenerate buttons send normal and forced character requests", () => {
  const listeners = new Map<string, () => void>();
  const sent: unknown[] = [];
  const byId = (id: string) => id === "sst-lumi-llm-regenerate" || id === "sst-lumi-llm-regenerate-character"
    ? { addEventListener: (_event: string, handler: () => void) => { listeners.set(id, handler); } }
    : null;

  registerSettingsActions({
    ctx: { sendToBackend: (message: unknown) => { sent.push(message); } } as SpindleFrontendContext,
    byId: byId as Parameters<typeof registerSettingsActions>[0]["byId"],
    state: { config: DEFAULT_CONFIG, configTrackerTagNameHint: "tracker", modelCombobox: null },
    readCurrentChatId: () => "chat-1",
    getPresetById: (_config, id) => getTemplatePresetById(id),
    isImportedTemplate: () => false,
    applyThemeClass: () => {},
    reapplyLatest: () => {},
    readLatestTrackerMessageId: () => "message-1",
    inlineProcessor: { processAll: () => {} } as Parameters<typeof registerSettingsActions>[0]["inlineProcessor"],
    setStatus: () => {},
    persistConfig: () => {},
    applyTagInterceptor: () => {},
    downloadJson: () => {},
    ensureModelCombobox: () => null,
    buildConnectionRef: () => ({ kind: "llm" }),
    setLLMStatus: () => {},
  });

  listeners.get("sst-lumi-llm-regenerate")?.();
  listeners.get("sst-lumi-llm-regenerate-character")?.();

  expect(sent).toEqual([
    { type: "regenerate_secondary_tracker", chatId: "chat-1", messageId: "message-1" },
    { type: "regenerate_secondary_tracker", chatId: "chat-1", messageId: "message-1", forceCharacterContext: true },
  ]);
});
