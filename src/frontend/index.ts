import type { SpindleAppMountHandle, SpindleFrontendContext, SpindleModelComboboxHandle } from "lumiverse-spindle-types";
import type { TemplatePreset } from "../shared/templatePresets";
import type { TrackerData } from "../shared/trackerData";
import { createReadyGate } from "./frontendReadyGate";
import type { TrackerMountMode } from "./frontendTemplate";
import { createTrackerRendering } from "./trackerRendering";
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


export function setup(ctx: SpindleFrontendContext) {
  // Lumiverse 1.0.6+ can explicitly release queued startup events once the
  // frontend has registered its handlers and issued its initial requests.
  const readyGate = createReadyGate(ctx);
  registerTemplateHelpers();
  ctx.dom.cleanup();

  let config: TrackerConfig = { ...DEFAULT_CONFIG };
  let removeHideStyle: (() => void) | null = null;
  let removeTagInterceptor: (() => void) | null = null;
  let tagInterceptorSignature: string | null = null;
  let previousTrackerData: TrackerData | null = null;
  let latestContent: string | null = null;
  let latestTrackerMessageId: string | null = null;
  let latestTrackerRaw: string | null = null;
  let latestTrackerSourceContent: string | null = null;
  let configReady = false;
  let pendingTrackerPayload: {
    raw: string;
    sourceContent: string;
    messageId: string | null;
    chatId: string | null;
    authoritative: boolean;
  } | null = null;
  let awaitingLatestTrackerChatId: string | null = null;
  let initialTrackerRehydrateRequested = false;
  const latestTrackerRequestsInFlight = new Set<string>();
  const trackerMessageIds = new Set<string>();
  const trackerMessageMounts = new Map<string, Element>();
  type TrackerRenderInputs = {
    data: TrackerData;
    preset: TemplatePreset;
    previousData: TrackerData | null;
    mode: TrackerMountMode;
  };
  type LatestMessageRenderIntent = TrackerRenderInputs & { messageId: string };
  const trackerMessageRenders = new Map<string, TrackerRenderInputs>();
  // Streaming may deliver the same message's tracker several times. Freeze
  // its baseline so final-chunk re-renders do not compare the payload to itself.
  const trackerComparisonBaselines = new Map<string, TrackerData | null>();
  const trackerGeneratingIndicators = new Map<string, Element>();
  let latestMessageRenderIntent: LatestMessageRenderIntent | null = null;
  let pendingGeneratingIndicatorMessageId: string | null = null;
  const inlineProcessor = createInlineTemplateProcessor({
    getConfig: () => ({
      enableInlineTemplates: config.enableInlineTemplates,
      inlinePacks: config.inlinePacks,
    }),
    getPreset: () => getPresetById(config, config.templateId),
  });
  let sideTrackerMount: Element | null = null;
  let sideAppMount: { mount: SpindleAppMountHandle; side: string } | null = null;
  let grantedPermissions: string[] = [];
  let requestedPermissions: string[] = [];
  let ephemeralPoolStatus: Record<string, unknown> | null = null;
  let connections: ConnectionProfile[] = [];
  let modelCombobox: SpindleModelComboboxHandle | null = null;
  let currentChatId: string | null = null;

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
      get pendingTrackerPayload() { return pendingTrackerPayload; },
      set pendingTrackerPayload(value) { pendingTrackerPayload = value; },
    },
    readConfig: () => config,
    writeConfig: (value) => { config = value; },
    readConnections: () => connections,
    readGrantedPermissions: () => grantedPermissions,
    readCurrentChatId: () => currentChatId,
    readLatestTrackerMessageId: () => latestTrackerMessageId,
    isConfigReady: () => configReady,
    readAwaitingLatestTrackerChatId: () => awaitingLatestTrackerChatId,
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
    state: {
      get previousTrackerData() { return previousTrackerData; },
      set previousTrackerData(value) { previousTrackerData = value; },
      get latestContent() { return latestContent; },
      set latestContent(value) { latestContent = value; },
      get latestTrackerMessageId() { return latestTrackerMessageId; },
      set latestTrackerMessageId(value) { latestTrackerMessageId = value; },
      get latestTrackerRaw() { return latestTrackerRaw; },
      set latestTrackerRaw(value) { latestTrackerRaw = value; },
      get latestTrackerSourceContent() { return latestTrackerSourceContent; },
      set latestTrackerSourceContent(value) { latestTrackerSourceContent = value; },
      get pendingTrackerPayload() { return pendingTrackerPayload; },
      set pendingTrackerPayload(value) { pendingTrackerPayload = value; },
      trackerMessageIds,
      trackerMessageMounts,
      trackerMessageRenders,
      trackerComparisonBaselines,
      trackerGeneratingIndicators,
      get latestMessageRenderIntent() { return latestMessageRenderIntent; },
      set latestMessageRenderIntent(value) { latestMessageRenderIntent = value; },
      get pendingGeneratingIndicatorMessageId() { return pendingGeneratingIndicatorMessageId; },
      set pendingGeneratingIndicatorMessageId(value) { pendingGeneratingIndicatorMessageId = value; },
      get sideTrackerMount() { return sideTrackerMount; },
      set sideTrackerMount(value) { sideTrackerMount = value; },
      get sideAppMount() { return sideAppMount; },
      set sideAppMount(value) { sideAppMount = value; },
    },
    readConfig: () => config,
    isConfigReady: () => configReady,
    readCurrentChatId: () => currentChatId,
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
    ctx.sendToBackend({ type: "set_config", config });
  };

  const requestLatestTracker = (chatId: string) => {
    if (latestTrackerRequestsInFlight.has(chatId)) return;
    latestTrackerRequestsInFlight.add(chatId);
    awaitingLatestTrackerChatId = chatId;
    ctx.sendToBackend({ type: "get_latest_tracker", chatId });
  };

  const requestInitialTrackerRehydrate = () => {
    if (initialTrackerRehydrateRequested) return;
    try {
      const active = ctx.getActiveChat();
      if (!active?.chatId) return;
      initialTrackerRehydrateRequested = true;
      if (!currentChatId) currentChatId = active.chatId;
      requestLatestTracker(active.chatId);
    } catch {
      // getActiveChat is best-effort; ignore if unavailable.
    }
  };

  const flushPendingTrackerPayload = () => {
    if (!configReady || awaitingLatestTrackerChatId || !pendingTrackerPayload) return;
    const pending = pendingTrackerPayload;
    pendingTrackerPayload = null;
    if (pending.chatId && currentChatId && pending.chatId !== currentChatId) return;
    handleTrackerPayload(pending.raw, pending.sourceContent, pending.messageId);
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
      get currentChatId() { return currentChatId; },
      set currentChatId(value) { currentChatId = value; },
      get awaitingLatestTrackerChatId() { return awaitingLatestTrackerChatId; },
      set awaitingLatestTrackerChatId(value) { awaitingLatestTrackerChatId = value; },
      get pendingTrackerPayload() { return pendingTrackerPayload; },
      set pendingTrackerPayload(value) { pendingTrackerPayload = value; },
      get configReady() { return configReady; },
      set configReady(value) { configReady = value; },
      get configRetryTimer() { return configRetryTimer; },
      set configRetryTimer(value) { configRetryTimer = value; },
      get latestContent() { return latestContent; },
      set latestContent(value) { latestContent = value; },
      get latestTrackerMessageId() { return latestTrackerMessageId; },
      set latestTrackerMessageId(value) { latestTrackerMessageId = value; },
      get latestTrackerRaw() { return latestTrackerRaw; },
      set latestTrackerRaw(value) { latestTrackerRaw = value; },
      get latestTrackerSourceContent() { return latestTrackerSourceContent; },
      set latestTrackerSourceContent(value) { latestTrackerSourceContent = value; },
      latestTrackerRequestsInFlight,
      trackerMessageIds,
      trackerComparisonBaselines,
    },
    panelHost,
    applyHideStyle,
    applyTagInterceptor,
    requestInitialTrackerRehydrate,
    showCommandResult,
    setStatus,
    isImportedTemplate,
    populateConnectionDropdown,
    setLLMStatus,
    isActivityForActiveChat: (chatId) => isActivityForActiveChat(chatId),
    showGeneratingIndicator,
    hideGeneratingIndicator,
    handleContent,
    flushPendingTrackerPayload,
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
      get currentChatId() { return currentChatId; },
      set currentChatId(value) { currentChatId = value; },
      get awaitingLatestTrackerChatId() { return awaitingLatestTrackerChatId; },
      set awaitingLatestTrackerChatId(value) { awaitingLatestTrackerChatId = value; },
      get pendingTrackerPayload() { return pendingTrackerPayload; },
      set pendingTrackerPayload(value) { pendingTrackerPayload = value; },
      get configReady() { return configReady; },
      set configReady(value) { configReady = value; },
      get latestTrackerMessageId() { return latestTrackerMessageId; },
      set latestTrackerMessageId(value) { latestTrackerMessageId = value; },
      get previousTrackerData() { return previousTrackerData; },
      set previousTrackerData(value) { previousTrackerData = value; },
      trackerComparisonBaselines,
      get latestTrackerRaw() { return latestTrackerRaw; },
      set latestTrackerRaw(value) { latestTrackerRaw = value; },
      get latestTrackerSourceContent() { return latestTrackerSourceContent; },
      set latestTrackerSourceContent(value) { latestTrackerSourceContent = value; },
      get latestContent() { return latestContent; },
      set latestContent(value) { latestContent = value; },
      get latestMessageRenderIntent() { return latestMessageRenderIntent; },
      set latestMessageRenderIntent(value) { latestMessageRenderIntent = value; },
      trackerMessageRenders,
      trackerMessageIds,
      trackerMessageMounts,
      get grantedPermissions() { return grantedPermissions; },
      set grantedPermissions(value) { grantedPermissions = value; },
      get requestedPermissions() { return requestedPermissions; },
      set requestedPermissions(value) { requestedPermissions = value; },
      get ephemeralPoolStatus() { return ephemeralPoolStatus; },
      set ephemeralPoolStatus(value) { ephemeralPoolStatus = value; },
    },
    inlineProcessor,
    updateRegenerateButton,
    renderEmpty,
    requestLatestTracker,
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
      get latestContent() { return latestContent; },
      set latestContent(value) { latestContent = value; },
      get latestTrackerMessageId() { return latestTrackerMessageId; },
      set latestTrackerMessageId(value) { latestTrackerMessageId = value; },
      get latestTrackerRaw() { return latestTrackerRaw; },
      set latestTrackerRaw(value) { latestTrackerRaw = value; },
      get latestTrackerSourceContent() { return latestTrackerSourceContent; },
      set latestTrackerSourceContent(value) { latestTrackerSourceContent = value; },
      get modelCombobox() { return modelCombobox; },
      set modelCombobox(value) { modelCombobox = value; },
      get currentChatId() { return currentChatId; },
      set currentChatId(value) { currentChatId = value; },
    },
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
  ctx.sendToBackend({ type: "get_config" });
  ctx.sendToBackend({ type: "get_connections" });
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
        ctx.sendToBackend({ type: "get_config" });
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
    for (const mount of trackerMessageMounts.values()) ctx.dom.uninject(mount);
    trackerMessageMounts.clear();
    trackerMessageRenders.clear();
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
