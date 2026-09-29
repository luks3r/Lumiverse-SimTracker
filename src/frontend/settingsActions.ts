import type { SpindleFrontendContext, SpindleModelComboboxHandle } from "lumiverse-spindle-types";
import type { TemplatePreset } from "../shared/templatePresets";
import type { TrackerConfig } from "../shared/trackerConfig";
import { DEFAULT_CONFIG } from "../shared/trackerConfig";
import { buildSavedFrontendConfig } from "./frontendSettingsValues";
import type { createInlineTemplateProcessor } from "./inlineTemplates";
import type { FrontendToBackendMessage } from "../shared/wireMessages";

export function registerSettingsActions(deps: {
  ctx: SpindleFrontendContext;
  byId: <T extends Element>(id: string) => T | null;
  state: {
    config: TrackerConfig;
    configTrackerTagNameHint: string;
    modelCombobox: SpindleModelComboboxHandle | null;
  };
  readCurrentChatId: () => string | null;
  getPresetById: (config: TrackerConfig, id: string) => TemplatePreset;
  isImportedTemplate: (config: TrackerConfig, id: string) => boolean;
  applyThemeClass: (preset: TemplatePreset) => void;
  reapplyLatest: () => void;
  readLatestTrackerMessageId: () => string | null;
  inlineProcessor: ReturnType<typeof createInlineTemplateProcessor>;
  setStatus: (text: string) => void;
  persistConfig: () => void;
  applyTagInterceptor: () => void;
  downloadJson: (filename: string, content: unknown) => void;
  ensureModelCombobox: () => SpindleModelComboboxHandle | null;
  buildConnectionRef: (connectionId: string) => { kind: "llm"; id: string } | { kind: "llm"; id?: never };
  setLLMStatus: (text: string, type?: "" | "generating" | "error") => void;
}) {
  const {
    ctx, byId, state, getPresetById, isImportedTemplate, applyThemeClass,
    reapplyLatest, inlineProcessor, setStatus,
    persistConfig, applyTagInterceptor, downloadJson, ensureModelCombobox,
    buildConnectionRef, setLLMStatus,
  } = deps;
  const saveButton = byId<HTMLElement>("sst-lumi-save");
  const templateSelect = byId<HTMLSelectElement>("sst-lumi-template");
  templateSelect?.addEventListener("change", () => {
    state.config = { ...state.config, templateId: templateSelect.value || DEFAULT_CONFIG.templateId };
    const deleteTemplateButton = byId<HTMLButtonElement>("sst-lumi-delete-template");
    if (deleteTemplateButton) deleteTemplateButton.disabled = !isImportedTemplate(state.config, state.config.templateId);
    const preset = getPresetById(state.config, state.config.templateId);
    applyThemeClass(preset);
    const identifierInput = byId<HTMLInputElement>("sst-lumi-identifier");
    if (identifierInput && preset.extSettings?.codeBlockIdentifier) {
      identifierInput.value = String(preset.extSettings.codeBlockIdentifier);
    }
    reapplyLatest();
    inlineProcessor.processAll();
    setStatus(`Previewing template: ${preset.templateName}. Click Save Settings to keep it.`);
  });

  saveButton?.addEventListener("click", () => {
    const templateSelectLocal = byId<HTMLSelectElement>("sst-lumi-template");
    const tagInput = byId<HTMLInputElement>("sst-lumi-tag");
    const identifierInput = byId<HTMLInputElement>("sst-lumi-identifier");
    const hideInput = byId<HTMLInputElement>("sst-lumi-hide");
    const inlineInput = byId<HTMLInputElement>("sst-lumi-inline");
    const formatSelect = byId<HTMLSelectElement>("sst-lumi-format");
    const retainInput = byId<HTMLInputElement>("sst-lumi-retain");
    const cycleBiasSelect = byId<HTMLSelectElement>("sst-lumi-cycle-bias");

    const selectedTemplate = templateSelectLocal?.value || DEFAULT_CONFIG.templateId;
    const preset = getPresetById(state.config, selectedTemplate);
    const fallbackId = preset.extSettings?.codeBlockIdentifier;

    const llmEnable = byId<HTMLInputElement>("sst-lumi-llm-enable");
    const llmConnection = byId<HTMLSelectElement>("sst-lumi-llm-connection");
    const llmMsgCount = byId<HTMLInputElement>("sst-lumi-llm-msgcount");
    const llmTemp = byId<HTMLInputElement>("sst-lumi-llm-temp");
    const llmStrip = byId<HTMLInputElement>("sst-lumi-llm-strip");
    const llmJsonResponseFormat = byId<HTMLInputElement>("sst-lumi-llm-json-format");
    const tsEnable = byId<HTMLInputElement>("sst-lumi-ts-enable");
    const tsKey = byId<HTMLInputElement>("sst-lumi-ts-key");
    const tsModel = byId<HTMLInputElement>("sst-lumi-ts-model");
    const tsQuick = byId<HTMLInputElement>("sst-lumi-ts-quick");
    const tsVerify = byId<HTMLInputElement>("sst-lumi-ts-verify");
    const tsConception = byId<HTMLInputElement>("sst-lumi-ts-conception");
    const tsConfidence = byId<HTMLInputElement>("sst-lumi-ts-confidence");

    state.config = buildSavedFrontendConfig(state.config, {
      selectedTemplate,
      tag: tagInput?.value,
      identifier: identifierInput?.value,
      hide: hideInput?.checked,
      inline: inlineInput?.checked,
      format: formatSelect?.value,
      retain: retainInput?.value,
      llmEnable: llmEnable?.checked,
      llmConnection: llmConnection?.value,
      llmModel: state.modelCombobox?.getValue(),
      llmMsgCount: llmMsgCount?.value,
      llmTemp: llmTemp?.value,
      llmStrip: llmStrip?.checked,
      llmJsonResponseFormat: llmJsonResponseFormat?.checked,
      cycleBias: cycleBiasSelect?.value,
      tsEnable: tsEnable?.checked,
      tsKey: tsKey?.value,
      tsModel: tsModel?.value,
      tsQuick: tsQuick?.checked,
      tsVerify: tsVerify?.checked,
      tsConception: tsConception?.checked,
      tsConfidence: tsConfidence?.value,
    }, fallbackId);
    persistConfig();
    state.configTrackerTagNameHint = state.config.trackerTagName;
    applyTagInterceptor();
    inlineProcessor.processAll();
    setStatus("Saving settings...");
  });

  const formatSelect = byId<HTMLSelectElement>("sst-lumi-format");
  formatSelect?.addEventListener("change", () => {
    const jsonFormat = byId<HTMLInputElement>("sst-lumi-llm-json-format");
    if (jsonFormat) jsonFormat.disabled = formatSelect.value !== "json";
  });

  const exportButton = byId<HTMLElement>("sst-lumi-export");
  exportButton?.addEventListener("click", () => {
    const preset = getPresetById(state.config, state.config.templateId);
    downloadJson(`${preset.templateName.replace(/\s+/g, "_").toLowerCase()}_preset.json`, preset);
    setStatus("Preset exported");
  });

  const deleteTemplateButton = byId<HTMLButtonElement>("sst-lumi-delete-template");
  deleteTemplateButton?.addEventListener("click", () => {
    const templateId = byId<HTMLSelectElement>("sst-lumi-template")?.value || "";
    const preset = isImportedTemplate(state.config, templateId)
      ? state.config.userPresets.find((item) => item.id === templateId)
      : null;
    if (!preset || !window.confirm(`Delete imported template "${preset.templateName}"?`)) return;
    deleteTemplateButton.disabled = true;
    ctx.sendToBackend({ type: "delete_preset", templateId } satisfies FrontendToBackendMessage);
    setStatus(`Deleting template: ${preset.templateName}...`);
  });

  const pickAndImport = async (statusPrefix: string) => {
    try {
      const files = await ctx.uploads.pickFile({
        accept: ["application/json", ".json"],
        multiple: false,
        maxSizeBytes: 3 * 1024 * 1024,
      });
      const file = files[0];
      if (!file) return;
      const text = new TextDecoder().decode(file.bytes);
      ctx.sendToBackend({
        type: "import_preset_file",
        fileName: file.name,
        text,
      } satisfies FrontendToBackendMessage);
      setStatus(`${statusPrefix} ${file.name}...`);
    } catch {
      setStatus("Import cancelled");
    }
  };

  const importPackButton = byId<HTMLElement>("sst-lumi-import-pack");
  importPackButton?.addEventListener("click", () => {
    void pickAndImport("Importing pack");
  });

  const importButton = byId<HTMLElement>("sst-lumi-import");
  importButton?.addEventListener("click", () => {
    void pickAndImport("Importing");
  });

  const llmConnectionSelect = byId<HTMLSelectElement>("sst-lumi-llm-connection");
  llmConnectionSelect?.addEventListener("change", () => {
    state.config = { ...state.config, secondaryLLMConnectionId: llmConnectionSelect.value, secondaryLLMModel: "" };
    ensureModelCombobox()?.update({
      connection: buildConnectionRef(llmConnectionSelect.value),
      value: "",
    });
  });

  const requestRegeneration = (forceCharacterContext: boolean) => {
    const chatId = deps.readCurrentChatId();
    if (!chatId) {
      setLLMStatus("Open a chat first to regenerate", "error");
      return;
    }
    setLLMStatus(forceCharacterContext ? "Regenerating with character context..." : "Regenerating tracker...", "generating");
    ctx.sendToBackend({
      type: "regenerate_secondary_tracker",
      chatId,
      // Hint the message we last rendered a tracker for, if any. Backend
      // falls back to the latest assistant message when this is absent
      // or stale, so a missing hint is fine.
      messageId: deps.readLatestTrackerMessageId() ?? undefined,
      ...(forceCharacterContext ? { forceCharacterContext: true } : {}),
    } satisfies FrontendToBackendMessage);
  };
  byId<HTMLButtonElement>("sst-lumi-llm-regenerate")?.addEventListener("click", () => requestRegeneration(false));
  byId<HTMLButtonElement>("sst-lumi-llm-regenerate-character")?.addEventListener("click", () => requestRegeneration(true));
}
