import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { TemplatePreset } from "../shared/templatePresets";
import { DEFAULT_CONFIG, FERTILITY_CYCLE_BIAS_VALUES, type FertilityCycleBias, type TrackerConfig } from "../shared/trackerConfig";
import { sanitizeIdentifier, sanitizeTagName } from "../shared/trackerSyntax";
import { CONFIG_ERROR_STATUS_PREFIX, DEFAULT_PANEL_STATUS } from "./frontendPanel";
import type { ConnectionProfile } from "./frontendControls";
import type { TrackerHydration } from "./trackerHydration";
import { readWireMessage } from "../shared/wireMessages";

export function registerBackendMessages(deps: {
  ctx: SpindleFrontendContext;
  byId: <T extends Element>(id: string) => T | null;
  state: {
    config: TrackerConfig;
    configTrackerTagNameHint: string;
    connections: ConnectionProfile[];
    grantedPermissions: string[];
    requestedPermissions: string[];
    ephemeralPoolStatus: Record<string, unknown> | null;
    configReady: boolean;
    configRetryTimer: ReturnType<typeof setTimeout> | null;
    latestContent: string | null;
    latestTrackerMessageId: string | null;
    latestTrackerRaw: string | null;
    latestTrackerSourceContent: string | null;
  };
  hydration: TrackerHydration;
  panelHost: { setSeededPresets: (presets: TemplatePreset[]) => void };
  applyHideStyle: () => void;
  applyTagInterceptor: () => void;
  showCommandResult: (payload: Record<string, unknown>) => void;
  setStatus: (text: string) => void;
  isImportedTemplate: (config: TrackerConfig, id: string) => boolean;
  populateConnectionDropdown: () => void;
  setLLMStatus: (text: string, type?: "" | "generating" | "error") => void;
  isActivityForActiveChat: (chatId: string | null) => boolean;
  showGeneratingIndicator: (messageId: string) => void;
  hideGeneratingIndicator: (messageId: string) => void;
  handleContent: (content: string, messageId: string | null) => void;
  renderCapabilities: (granted: string[], requested: string[], ephemeral: Record<string, unknown> | null) => void;
  updatePermissionGatedControls: () => void;
  syncControls: () => void;
  applyThemeClass: (preset: TemplatePreset) => void;
  getPresetById: (config: TrackerConfig, id: string) => TemplatePreset;
  handleTrackerPayload: (raw: string, sourceContent: string, messageId: string | null) => void;
  shouldResetStatusAfterConfigLoad: () => boolean;
  inlineProcessor: { processAll: () => void };
}) {
  const {
    ctx, byId, state, panelHost, applyHideStyle, applyTagInterceptor,
    hydration, showCommandResult, setStatus,
    isImportedTemplate, populateConnectionDropdown, setLLMStatus,
    isActivityForActiveChat, showGeneratingIndicator, hideGeneratingIndicator,
    handleContent, renderCapabilities,
    updatePermissionGatedControls, syncControls, applyThemeClass, getPresetById,
    handleTrackerPayload, shouldResetStatusAfterConfigLoad, inlineProcessor,
  } = deps;
  const backendUnsub = ctx.onBackendMessage((payload: unknown) => {
    const obj = readWireMessage(payload);
    if (!obj) return;
    if (obj?.type === "tag_interceptor_config") {
      state.config = {
        ...state.config,
        trackerTagName: typeof obj.tagName === "string"
          ? sanitizeTagName(obj.tagName)
          : state.config.trackerTagName,
        codeBlockIdentifier: typeof obj.tagType === "string"
          ? sanitizeIdentifier(obj.tagType)
          : state.config.codeBlockIdentifier,
        hideSimBlocks: typeof obj.removeFromMessage === "boolean"
          ? obj.removeFromMessage
          : state.config.hideSimBlocks,
      };
      state.configTrackerTagNameHint = state.config.trackerTagName;
      applyHideStyle();
      applyTagInterceptor();
      hydration.requestInitial();
      return;
    }
    if (obj?.type === "command_result" && obj.payload && typeof obj.payload === "object") {
      showCommandResult(obj.payload as Record<string, unknown>);
      const cmd = (obj.payload as Record<string, unknown>).command;
      if (typeof cmd === "string") {
        setStatus(`Handled /${cmd}`);
      }
      return;
    }
    if (obj?.type === "import_result") {
      const ok = Boolean(obj.ok);
      const message = typeof obj.message === "string" ? obj.message : ok ? "Import complete" : "Import failed";
      setStatus(message);
      return;
    }
    if (obj?.type === "delete_preset_result") {
      const message = typeof obj.message === "string" ? obj.message : "Template deletion failed";
      setStatus(message);
      if (!obj.ok) {
        const deleteTemplateButton = byId<HTMLButtonElement>("sst-lumi-delete-template");
        const selectedId = byId<HTMLSelectElement>("sst-lumi-template")?.value || "";
        if (deleteTemplateButton) deleteTemplateButton.disabled = !isImportedTemplate(state.config, selectedId);
      }
      return;
    }
    if (obj?.type === "config_error") {
      const message = typeof obj.message === "string" && obj.message.trim() ? obj.message.trim() : "Unknown error";
      const operation = obj.operation === "save" ? "Config save failed:" : CONFIG_ERROR_STATUS_PREFIX;
      setStatus(`${operation} ${message}`);
      return;
    }
    if (obj?.type === "config_saved") {
      setStatus("Settings saved");
      return;
    }
    if (obj?.type === "connections_list" && Array.isArray(obj.connections)) {
      state.connections = obj.connections as ConnectionProfile[];
      populateConnectionDropdown();
      if (state.connections.length) {
        setLLMStatus(`${state.connections.length} connection(s) available`);
      } else {
        const reason = typeof obj.error === "string" ? obj.error : "";
        setLLMStatus(reason || "No connections available", reason ? "error" : "");
      }
      return;
    }
    if (obj?.type === "secondary_generation_started") {
      const responseChatId = typeof obj.chatId === "string" ? obj.chatId : null;
      if (!isActivityForActiveChat(responseChatId)) return;
      setLLMStatus("Generating tracker data...", "generating");
      setStatus("Secondary LLM generating...");
      const startedId = typeof obj.messageId === "string" ? obj.messageId : null;
      if (startedId) showGeneratingIndicator(startedId);
      return;
    }
    if (obj?.type === "secondary_generation_complete") {
      const responseChatId = typeof obj.chatId === "string" ? obj.chatId : null;
      if (!isActivityForActiveChat(responseChatId)) return;
      setLLMStatus(obj.via === "typesafe-fast-lane" ? "Tracker appended via TypeSafe quick path" : "Generation complete");
      const content = typeof obj.content === "string" ? obj.content : null;
      const messageId = typeof obj.messageId === "string" ? obj.messageId : null;
      if (messageId) hideGeneratingIndicator(messageId);
      if (content) handleContent(content, messageId);
      return;
    }
    if (obj?.type === "secondary_generation_skipped") {
      const responseChatId = typeof obj.chatId === "string" ? obj.chatId : null;
      if (!isActivityForActiveChat(responseChatId)) return;
      setLLMStatus("No tracker changes needed (TypeSafe gate)");
      setStatus("Tracker unchanged — TypeSafe gate found no state changes.");
      const skippedId = typeof obj.messageId === "string" ? obj.messageId : null;
      if (skippedId) hideGeneratingIndicator(skippedId);
      return;
    }
    if (obj?.type === "secondary_generation_error") {
      const responseChatId = typeof obj.chatId === "string" ? obj.chatId : null;
      if (!isActivityForActiveChat(responseChatId)) return;
      const msg = typeof obj.message === "string" ? obj.message : "Generation failed";
      setLLMStatus(msg, "error");
      const errorId = typeof obj.messageId === "string" ? obj.messageId : null;
      if (errorId) hideGeneratingIndicator(errorId);
      return;
    }
    if (obj?.type === "tracker_history_latest") {
      const responseChatId = typeof obj.chatId === "string" ? obj.chatId : null;
      const entry = obj.entry as { messageId?: unknown; payload?: unknown; previousPayload?: unknown } | null;
      hydration.acceptLatest(responseChatId, entry);
      return;
    }
    if (obj?.type === "permission_changed") {
      const allGranted = Array.isArray(obj.allGranted)
        ? obj.allGranted.filter((p): p is string => typeof p === "string")
        : state.grantedPermissions;
      state.grantedPermissions = allGranted;
      renderCapabilities(state.grantedPermissions, state.requestedPermissions, state.ephemeralPoolStatus);
      updatePermissionGatedControls();
      return;
    }
    if (obj?.type !== "config" || !obj.config || typeof obj.config !== "object") return;
    const incoming = obj.config as Record<string, unknown>;
    state.grantedPermissions = Array.isArray(obj.grantedPermissions)
      ? obj.grantedPermissions.filter((p): p is string => typeof p === "string")
      : state.grantedPermissions;
    state.requestedPermissions = Array.isArray(obj.requestedPermissions)
      ? obj.requestedPermissions.filter((p): p is string => typeof p === "string")
      : state.requestedPermissions;
    if (Array.isArray(obj.seededPresets)) {
      panelHost.setSeededPresets(obj.seededPresets as TemplatePreset[]);
    }
    state.ephemeralPoolStatus = obj.ephemeralPoolStatus && typeof obj.ephemeralPoolStatus === "object"
      ? (obj.ephemeralPoolStatus as Record<string, unknown>)
      : null;
    state.config = {
      trackerTagName: typeof incoming.trackerTagName === "string" ? sanitizeTagName(incoming.trackerTagName) : DEFAULT_CONFIG.trackerTagName,
      codeBlockIdentifier: typeof incoming.codeBlockIdentifier === "string" ? sanitizeIdentifier(incoming.codeBlockIdentifier) : DEFAULT_CONFIG.codeBlockIdentifier,
      hideSimBlocks: typeof incoming.hideSimBlocks === "boolean" ? incoming.hideSimBlocks : DEFAULT_CONFIG.hideSimBlocks,
      templateId: typeof incoming.templateId === "string" ? incoming.templateId : DEFAULT_CONFIG.templateId,
      trackerFormat: incoming.trackerFormat === "yaml" ? "yaml" : "json",
      retainTrackerCount: typeof incoming.retainTrackerCount === "number" ? incoming.retainTrackerCount : DEFAULT_CONFIG.retainTrackerCount,
      enableInlineTemplates:
        typeof incoming.enableInlineTemplates === "boolean"
          ? incoming.enableInlineTemplates
          : DEFAULT_CONFIG.enableInlineTemplates,
      userPresets: Array.isArray(incoming.userPresets) ? (incoming.userPresets as TemplatePreset[]) : [],
      inlinePacks: Array.isArray(incoming.inlinePacks) ? (incoming.inlinePacks as Array<Record<string, unknown>>) : [],
      useSecondaryLLM: typeof incoming.useSecondaryLLM === "boolean" ? incoming.useSecondaryLLM : DEFAULT_CONFIG.useSecondaryLLM,
      secondaryLLMConnectionId: typeof incoming.secondaryLLMConnectionId === "string" ? incoming.secondaryLLMConnectionId : DEFAULT_CONFIG.secondaryLLMConnectionId,
      secondaryLLMModel: typeof incoming.secondaryLLMModel === "string" ? incoming.secondaryLLMModel : DEFAULT_CONFIG.secondaryLLMModel,
      secondaryLLMMessageCount: typeof incoming.secondaryLLMMessageCount === "number" ? incoming.secondaryLLMMessageCount : DEFAULT_CONFIG.secondaryLLMMessageCount,
      secondaryLLMTemperature: typeof incoming.secondaryLLMTemperature === "number" ? incoming.secondaryLLMTemperature : DEFAULT_CONFIG.secondaryLLMTemperature,
      secondaryLLMStripHTML: typeof incoming.secondaryLLMStripHTML === "boolean" ? incoming.secondaryLLMStripHTML : DEFAULT_CONFIG.secondaryLLMStripHTML,
      fertilityCycleBias:
        typeof incoming.fertilityCycleBias === "string" && (FERTILITY_CYCLE_BIAS_VALUES as readonly string[]).includes(incoming.fertilityCycleBias)
          ? (incoming.fertilityCycleBias as FertilityCycleBias)
          : DEFAULT_CONFIG.fertilityCycleBias,
      typeSafeEnabled: typeof incoming.typeSafeEnabled === "boolean" ? incoming.typeSafeEnabled : DEFAULT_CONFIG.typeSafeEnabled,
      typeSafeApiKey: typeof incoming.typeSafeApiKey === "string" ? incoming.typeSafeApiKey : DEFAULT_CONFIG.typeSafeApiKey,
      typeSafeModel: typeof incoming.typeSafeModel === "string" && incoming.typeSafeModel.trim() ? incoming.typeSafeModel.trim() : DEFAULT_CONFIG.typeSafeModel,
      typeSafeQuickAppend: typeof incoming.typeSafeQuickAppend === "boolean" ? incoming.typeSafeQuickAppend : DEFAULT_CONFIG.typeSafeQuickAppend,
      typeSafeVerify: typeof incoming.typeSafeVerify === "boolean" ? incoming.typeSafeVerify : DEFAULT_CONFIG.typeSafeVerify,
      typeSafeConception: typeof incoming.typeSafeConception === "boolean" ? incoming.typeSafeConception : DEFAULT_CONFIG.typeSafeConception,
      typeSafeConfidenceFloor:
        typeof incoming.typeSafeConfidenceFloor === "number" && Number.isFinite(incoming.typeSafeConfidenceFloor)
          ? Math.min(0.95, Math.max(0.3, incoming.typeSafeConfidenceFloor))
          : DEFAULT_CONFIG.typeSafeConfidenceFloor,
    };
    state.configReady = true;
    if (state.configRetryTimer) {
      clearTimeout(state.configRetryTimer);
      state.configRetryTimer = null;
    }
    syncControls();
    state.configTrackerTagNameHint = state.config.trackerTagName;
    applyHideStyle();
    applyTagInterceptor();
    applyThemeClass(getPresetById(state.config, state.config.templateId));
    renderCapabilities(state.grantedPermissions, state.requestedPermissions, state.ephemeralPoolStatus);
    updatePermissionGatedControls();
    if (state.latestContent) {
      handleContent(state.latestContent, state.latestTrackerMessageId);
    } else if (state.latestTrackerRaw) {
      handleTrackerPayload(state.latestTrackerRaw, state.latestTrackerSourceContent || state.latestTrackerRaw, state.latestTrackerMessageId);
    }
    if (shouldResetStatusAfterConfigLoad()) {
      setStatus(DEFAULT_PANEL_STATUS);
    }
    hydration.requestInitial();
    hydration.flushPending();
    inlineProcessor.processAll();
  });
  return backendUnsub;
}
