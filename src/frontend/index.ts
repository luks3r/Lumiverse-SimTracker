import type { SpindleFrontendContext, SpindleModelComboboxHandle } from "lumiverse-spindle-types";
import { parseTrackerBlock } from "../shared/trackerData";
import { createReadyGate } from "./frontendReadyGate";
import { createTrackerRendering } from "./trackerRendering";
import { createTrackerRenderState } from "./trackerRenderState";
import { LOADING_CONFIG_STATUS, PANEL_CSS, PANEL_HTML } from "./frontendPanel";
import { createPanelHost } from "./panelHost";
import { createFrontendControls, type ConnectionProfile } from "./frontendControls";
import { registerBackendMessages } from "./backendMessages";
import { registerChatEvents } from "./chatEvents";
import { registerSettingsActions } from "./settingsActions";
import { registerTemplateHelpers } from "./frontendTemplateHelpers";
import { createInlineTemplateProcessor } from "./inlineTemplates";
import { DEFAULT_CONFIG, type TrackerConfig } from "../shared/trackerConfig";
import { createFrontendMessageSyntax } from "./frontendMessageSyntax";
import type { FrontendToBackendMessage } from "../shared/wireMessages";
import { createTrackerHydration } from "./trackerHydration";

export function setup(ctx: SpindleFrontendContext) {
  const panelHost = createPanelHost();
  const {
    byId,
    getPresetById,
    isImportedTemplate,
    setStatus,
    shouldResetStatusAfterConfigLoad,
    renderCapabilities,
    renderEmpty,
    applyThemeClass,
    renderTracker,
    showCommandResult,
    mountTemplateOptions,
    downloadJson,
  } = panelHost;
  let configTrackerTagNameHint = "tracker";
  const { extractTrackerBlock } = createFrontendMessageSyntax(() => configTrackerTagNameHint);

  // Lumiverse 1.0.6+ can explicitly release queued startup events once the
  // frontend has registered its handlers and issued its initial requests.
  const readyGate = createReadyGate(ctx);
  registerTemplateHelpers();
  ctx.dom.cleanup();

  let config: TrackerConfig = { ...DEFAULT_CONFIG };
  let removeHideStyle: (() => void) | null = null;
  let removeTagInterceptor: (() => void) | null = null;
  let tagInterceptorSignature: string | null = null;
  const renderState = createTrackerRenderState();
  let configReady = false;
  const inlineProcessor = createInlineTemplateProcessor({
    getConfig: () => ({
      enableInlineTemplates: config.enableInlineTemplates,
      inlinePacks: config.inlinePacks,
    }),
    getPreset: () => getPresetById(config, config.templateId),
  });
  let grantedPermissions: string[] = [];
  let requestedPermissions: string[] = [];
  let ephemeralPoolStatus: Record<string, unknown> | null = null;
  let connections: ConnectionProfile[] = [];
  let modelCombobox: SpindleModelComboboxHandle | null = null;
  const hydration = createTrackerHydration({
    getActiveChatId: () => ctx.getActiveChat()?.chatId || null,
    sendLatestRequest: (chatId) => ctx.sendToBackend({ type: "get_latest_tracker", chatId } satisfies FrontendToBackendMessage),
    isConfigReady: () => configReady,
    hasRenderedMessage: (messageId) => renderState.trackerMessageIds.has(messageId),
    setComparisonBaseline: (messageId, previousPayload) => {
      renderState.trackerComparisonBaselines.clear();
      renderState.trackerComparisonBaselines.set(messageId, previousPayload ? parseTrackerBlock(previousPayload) : null);
    },
    renderPayload: (payload) => handleTrackerPayload(payload.raw, payload.sourceContent, payload.messageId),
  });

  const removePanelStyle = ctx.dom.addStyle(PANEL_CSS);
  const mountRoot = ctx.ui.mount("settings_extensions");

  // Defensive cleanup: if a previous hot/reload cycle left stale panels,
  // remove them before injecting a fresh instance.
  const stalePanels = document.querySelectorAll("#sst-lumi-panel");
  stalePanels.forEach((node) => node.remove());

  panelHost.setPanelRoot(ctx.dom.inject(mountRoot, PANEL_HTML, "beforeend"));
  renderCapabilities([], [], null);
  mountTemplateOptions(config);

  const {
    applyHideStyle,
    buildConnectionRef,
    ensureModelCombobox,
    populateConnectionDropdown,
    setLLMStatus,
    hasPermission,
    updateRegenerateButton,
    updatePermissionGatedControls,
    applyTagInterceptor,
    syncControls,
  } = createFrontendControls({
    ctx,
    byId,
    state: {
      get removeHideStyle() { return removeHideStyle; },
      set removeHideStyle(value) { removeHideStyle = value; },
      get removeTagInterceptor() { return removeTagInterceptor; },
      set removeTagInterceptor(value) { removeTagInterceptor = value; },
      get tagInterceptorSignature() { return tagInterceptorSignature; },
      set tagInterceptorSignature(value) { tagInterceptorSignature = value; },
      get modelCombobox() { return modelCombobox; },
      set modelCombobox(value) { modelCombobox = value; },
    },
    hydration,
    readConfig: () => config,
    writeConfig: (value) => { config = value; },
    readConnections: () => connections,
    readGrantedPermissions: () => grantedPermissions,
    readLatestTrackerMessageId: () => renderState.latestTrackerMessageId,
    isConfigReady: () => configReady,
    isActivityForActiveChat: (chatId) => isActivityForActiveChat(chatId),
    handleTrackerPayload: (raw, sourceContent, messageId) => handleTrackerPayload(raw, sourceContent, messageId),
    mountTemplateOptions,
    isImportedTemplate,
  });

  const {
    clearMessageTrackerRender,
    clearLatestMessageRenderIntent,
    retryLatestMessageRenderIntent,
    clearSideTrackerRender,
    showGeneratingIndicator,
    hideGeneratingIndicator,
    hideAllGeneratingIndicators,
    retryGeneratingIndicator,
    handleTrackerPayload,
    handleContent,
  } = createTrackerRendering({
    ctx,
    byId,
    state: renderState,
    hydration,
    readConfig: () => config,
    isConfigReady: () => configReady,
    getPresetById,
    extractTrackerBlock,
    setStatus,
    renderEmpty,
    renderTracker,
    applyThemeClass,
    updateRegenerateButton,
    hasPermission,
  });

  const persistConfig = () => {
    ctx.sendToBackend({ type: "set_config", config } satisfies FrontendToBackendMessage);
  };

  const backendUnsub = registerBackendMessages({
    ctx,
    byId,
    state: {
      get config() { return config; },
      set config(value) { config = value; },
      get configTrackerTagNameHint() { return configTrackerTagNameHint; },
      set configTrackerTagNameHint(value) { configTrackerTagNameHint = value; },
      get connections() { return connections; },
      set connections(value) { connections = value; },
      get grantedPermissions() { return grantedPermissions; },
      set grantedPermissions(value) { grantedPermissions = value; },
      get requestedPermissions() { return requestedPermissions; },
      set requestedPermissions(value) { requestedPermissions = value; },
      get ephemeralPoolStatus() { return ephemeralPoolStatus; },
      set ephemeralPoolStatus(value) { ephemeralPoolStatus = value; },
      get configReady() { return configReady; },
      set configReady(value) { configReady = value; },
      get configRetryTimer() { return configRetryTimer; },
      set configRetryTimer(value) { configRetryTimer = value; },
      get latestContent() { return renderState.latestContent; },
      set latestContent(value) { renderState.latestContent = value; },
      get latestTrackerMessageId() { return renderState.latestTrackerMessageId; },
      set latestTrackerMessageId(value) { renderState.latestTrackerMessageId = value; },
      get latestTrackerRaw() { return renderState.latestTrackerRaw; },
      set latestTrackerRaw(value) { renderState.latestTrackerRaw = value; },
      get latestTrackerSourceContent() { return renderState.latestTrackerSourceContent; },
      set latestTrackerSourceContent(value) { renderState.latestTrackerSourceContent = value; },
    },
    hydration,
    panelHost,
    applyHideStyle,
    applyTagInterceptor,
    showCommandResult,
    setStatus,
    isImportedTemplate,
    populateConnectionDropdown,
    setLLMStatus,
    isActivityForActiveChat: (chatId) => isActivityForActiveChat(chatId),
    showGeneratingIndicator,
    hideGeneratingIndicator,
    handleContent,
    renderCapabilities,
    updatePermissionGatedControls,
    syncControls,
    applyThemeClass,
    getPresetById,
    handleTrackerPayload,
    shouldResetStatusAfterConfigLoad,
    inlineProcessor,
  });

  const {
    isActivityForActiveChat,
    generationUnsub,
    messageUnsub,
    messageEditedUnsub,
    messageSwipedUnsub,
    swipeEditedUnsub,
    messageDeletedUnsub,
    messageRenderedUnsub,
    chatSwitchedUnsub,
    stopInlineObserver,
    permissionUnsub,
  } = registerChatEvents({
    ctx,
    state: {
      get configReady() { return configReady; },
      set configReady(value) { configReady = value; },
      get latestTrackerMessageId() { return renderState.latestTrackerMessageId; },
      set latestTrackerMessageId(value) { renderState.latestTrackerMessageId = value; },
      get previousTrackerData() { return renderState.previousTrackerData; },
      set previousTrackerData(value) { renderState.previousTrackerData = value; },
      trackerComparisonBaselines: renderState.trackerComparisonBaselines,
      get latestTrackerRaw() { return renderState.latestTrackerRaw; },
      set latestTrackerRaw(value) { renderState.latestTrackerRaw = value; },
      get latestTrackerSourceContent() { return renderState.latestTrackerSourceContent; },
      set latestTrackerSourceContent(value) { renderState.latestTrackerSourceContent = value; },
      get latestContent() { return renderState.latestContent; },
      set latestContent(value) { renderState.latestContent = value; },
      get latestMessageRenderIntent() { return renderState.latestMessageRenderIntent; },
      set latestMessageRenderIntent(value) { renderState.latestMessageRenderIntent = value; },
      trackerMessageRenders: renderState.trackerMessageRenders,
      trackerMessageIds: renderState.trackerMessageIds,
      trackerMessageMounts: renderState.trackerMessageMounts,
      get grantedPermissions() { return grantedPermissions; },
      set grantedPermissions(value) { grantedPermissions = value; },
      get requestedPermissions() { return requestedPermissions; },
      set requestedPermissions(value) { requestedPermissions = value; },
      get ephemeralPoolStatus() { return ephemeralPoolStatus; },
      set ephemeralPoolStatus(value) { ephemeralPoolStatus = value; },
    },
    hydration,
    inlineProcessor,
    updateRegenerateButton,
    renderEmpty,
    handleContent,
    clearSideTrackerRender,
    clearMessageTrackerRender,
    retryLatestMessageRenderIntent,
    retryGeneratingIndicator,
    clearLatestMessageRenderIntent,
    hideGeneratingIndicator,
    hideAllGeneratingIndicators,
    renderCapabilities,
    updatePermissionGatedControls,
  });
  registerSettingsActions({
    ctx,
    byId,
    state: {
      get config() { return config; },
      set config(value) { config = value; },
      get configTrackerTagNameHint() { return configTrackerTagNameHint; },
      set configTrackerTagNameHint(value) { configTrackerTagNameHint = value; },
      get latestContent() { return renderState.latestContent; },
      set latestContent(value) { renderState.latestContent = value; },
      get latestTrackerMessageId() { return renderState.latestTrackerMessageId; },
      set latestTrackerMessageId(value) { renderState.latestTrackerMessageId = value; },
      get latestTrackerRaw() { return renderState.latestTrackerRaw; },
      set latestTrackerRaw(value) { renderState.latestTrackerRaw = value; },
      get latestTrackerSourceContent() { return renderState.latestTrackerSourceContent; },
      set latestTrackerSourceContent(value) { renderState.latestTrackerSourceContent = value; },
      get modelCombobox() { return modelCombobox; },
      set modelCombobox(value) { modelCombobox = value; },
    },
    readCurrentChatId: hydration.currentChatId,
    getPresetById,
    isImportedTemplate,
    applyThemeClass,
    handleContent,
    handleTrackerPayload,
    inlineProcessor,
    setStatus,
    persistConfig,
    applyTagInterceptor,
    downloadJson,
    ensureModelCombobox,
    buildConnectionRef,
    setLLMStatus,
  });

  void ctx.permissions.getGranted().then((granted) => {
    grantedPermissions = granted;
    renderCapabilities(grantedPermissions, requestedPermissions, ephemeralPoolStatus);
  }).catch(() => {
    renderCapabilities(grantedPermissions, requestedPermissions, ephemeralPoolStatus);
  });

  ensureModelCombobox();
  ctx.sendToBackend({ type: "get_config" } satisfies FrontendToBackendMessage);
  ctx.sendToBackend({ type: "get_connections" } satisfies FrontendToBackendMessage);
  updatePermissionGatedControls();
  setStatus(LOADING_CONFIG_STATUS);
  renderEmpty("When a message includes a tracker tag, cards will appear here.");

  // Retry config request after a short delay in case the backend is still
  // initializing following an extension update or host restart.
  let configRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleConfigRetry = () => {
    if (configReady) return;
    configRetryTimer = setTimeout(() => {
      if (!configReady) {
        ctx.sendToBackend({ type: "get_config" } satisfies FrontendToBackendMessage);
        scheduleConfigRetry();
      }
    }, 2000);
  };
  scheduleConfigRetry();
  readyGate.release();

  return () => {
    readyGate.dispose();
    panelHost.setPanelRoot(null);
    if (modelCombobox) {
      modelCombobox.destroy();
      modelCombobox = null;
    }
    backendUnsub();
    generationUnsub();
    messageUnsub();
    messageEditedUnsub();
    messageSwipedUnsub();
    swipeEditedUnsub();
    messageDeletedUnsub();
    messageRenderedUnsub();
    chatSwitchedUnsub();
    stopInlineObserver();
    permissionUnsub();
    if (removeHideStyle) removeHideStyle();
    if (removeTagInterceptor) removeTagInterceptor();
    clearSideTrackerRender();
    for (const mount of renderState.trackerMessageMounts.values()) ctx.dom.uninject(mount);
    renderState.trackerMessageMounts.clear();
    renderState.trackerMessageRenders.clear();
    hideAllGeneratingIndicators();
    inlineProcessor.destroy();
    removePanelStyle();
    ctx.dom.cleanup();
    if (configRetryTimer) {
      clearTimeout(configRetryTimer);
      configRetryTimer = null;
    }
  };
}
