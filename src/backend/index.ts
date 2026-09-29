import { getTemplatePresetById, getTemplatePresets, mergeTemplatePresets, type TemplatePreset } from "../shared/templatePresets";
import { formatTrackerForPrompt } from "./trackerPayload";
import { DEFAULT_CONFIG, type TrackerConfig } from "../shared/trackerConfig";
import { createTrackerMessageCodec } from "./trackerMessageCodec";
import { createTrackerHistory } from "./trackerHistory";
import { createLegacyTrackerNormalizer } from "./trackerLegacyMigration";
import { discoverSeededPresets } from "./seededPresets";
import { createImportService } from "./importService";
import { createSecondaryGeneration } from "./secondaryGeneration";
import { createFrontendMessageHandler } from "./frontendMessages";
import { createPromptInterceptor } from "./promptInterceptor";
import { registerMessageEvents } from "./messageEvents";
import { registerChatLifecycleEvents } from "./chatLifecycleEvents";
import { createConceptionGate } from "./conceptionGate";
import { createMacroPublisher } from "./macroPublisher";
import { createCommandEngine } from "./commandEngine";
import { createSettingsStore } from "./settingsStore";
import type { TypeSafeCorsTransport } from "./typesafe";

/**
 * DI-boundary adapter: routes every TypeSafe call through Lumiverse's CORS
 * proxy (requires the `cors_proxy` permission). Shared by the fast lane, the
 * verifier, and the conception gate.
 */
const typeSafeCorsTransport: TypeSafeCorsTransport = (url, options) => spindle.cors(url, options);

declare const spindle: import("lumiverse-spindle-types").SpindleAPI & {
  frontendCapabilities?: {
    declare(capability: "message_tag_interceptor"): () => void;
  };
};

// Tell the host that chat content is not display-stable until this
// extension's frontend has attached its configured tag interceptor. The host
// snapshots this declaration before low-priority frontend hydration, avoiding
// a first paint of raw tracker JSON on chat load.
spindle.frontendCapabilities?.declare("message_tag_interceptor");

let config: TrackerConfig = { ...DEFAULT_CONFIG };
const latestTrackerByChat = new Map<string, string>();
let selectedChatId: string | null = null;
let selectedChatKnown = false;
let activeUserId: string | null = null;
let loadedConfigUserId: string | null = null;
let firstMessageFertilityHint = "";

/**
 * Last chat id the extension saw activity on. The interceptor signature
 * (`context: unknown`) doesn't contractually expose the chat id, so we
 * mirror it from `GENERATION_STARTED` (which does carry it) and from
 * any other event that surfaces a chat id. Used as a fallback when the
 * interceptor context can't be parsed.
 */
let activeChatId: string | null = null;

const runtime = {
  grantedPermissions: new Set<string>(),
  seededPresets: [] as TemplatePreset[],
  seededPresetsLoaded: false,
};

function getAllPresets(): TemplatePreset[] {
  return mergeTemplatePresets(getTemplatePresets(), runtime.seededPresets, config.userPresets);
}

function getActivePreset(): TemplatePreset {
  return getAllPresets().find((preset) => preset.id === config.templateId)
    || getTemplatePresetById(config.templateId)
    || getTemplatePresetById(DEFAULT_CONFIG.templateId);
}

const trackerMessageCodec = createTrackerMessageCodec(() => config);
const { extractTrackerPayloadFromMessage, normalizeLegacyHiddenDivTrackers } = trackerMessageCodec;
const normalizeLegacyTrackersInChat = createLegacyTrackerNormalizer({
  getMessages: (chatId) => spindle.chat.getMessages(chatId),
  updateMessage: (chatId, messageId, change) => spindle.chat.updateMessage(chatId, messageId, change),
  hasChatMutationPermission: () => hasPermission("chat_mutation"),
  normalizeLegacyHiddenDivTrackers,
  logInfo: (message) => spindle.log.info(message),
});
const {
  recordChatTracker: recordHistoryTracker,
  forgetChatTracker: forgetHistoryTracker,
  getChatTrackerHistory,
  rehydrateChatTrackerHistory: rehydrateHistory,
  getRecentChatTrackers,
} = createTrackerHistory({
  normalizeLegacyTrackersInChat,
  extractTrackerPayloadFromMessage,
  readRetainCount: () => config.retainTrackerCount,
});
function readLastSimStats(chatId: string | null): string {
  if (!chatId) return "{}";
  return latestTrackerByChat.get(chatId) ?? getChatTrackerHistory(chatId).at(-1)?.payload ?? "{}";
}

function publishSelectedTracker(): void {
  spindle.updateMacroValue("last_sim_stats", formatTrackerForPrompt(readLastSimStats(selectedChatId)));
}

function selectChat(chatId: string | null): void {
  selectedChatKnown = true;
  selectedChatId = chatId;
  publishSelectedTracker();
}

function recordChatTracker(chatId: string | null, messageId: string | null, payload: string): void {
  recordHistoryTracker(chatId, messageId, payload);
  if (!chatId) return;
  latestTrackerByChat.set(chatId, payload);
  if (!selectedChatKnown) selectChat(chatId);
  else if (selectedChatId === chatId) publishSelectedTracker();
}

function forgetChatTracker(chatId: string | null, messageId: string | null): void {
  forgetHistoryTracker(chatId, messageId);
  if (!chatId) return;
  const latest = getChatTrackerHistory(chatId).at(-1)?.payload;
  if (latest) latestTrackerByChat.set(chatId, latest);
  else latestTrackerByChat.delete(chatId);
  if (selectedChatId === chatId) publishSelectedTracker();
}

async function rehydrateChatTrackerHistory(chatId: string | null): Promise<void> {
  await rehydrateHistory(chatId);
  if (!chatId) return;
  const latest = getChatTrackerHistory(chatId).at(-1)?.payload;
  if (latest) latestTrackerByChat.set(chatId, latest);
  if (selectedChatId === chatId) publishSelectedTracker();
}

function writeLastSimStats(chatId: string | null, value: string, messageId?: string | null): void {
  if (!chatId) return;
  if (messageId) {
    recordChatTracker(chatId, messageId, value);
    return;
  }
  latestTrackerByChat.set(chatId, value);
  if (!selectedChatKnown) selectChat(chatId);
  else if (selectedChatId === chatId) publishSelectedTracker();
}
const { handleSlashCommand } = createCommandEngine({
  readConfig: () => config,
  readLastSimStats,
  writeLastSimStats,
  getActivePreset,
  extractTrackerPayloadFromMessage,
  hasChatMutationPermission: () => hasPermission("chat_mutation"),
  getMessages: (chatId) => spindle.chat.getMessages(chatId),
  updateMessage: (chatId, messageId, change) => spindle.chat.updateMessage(chatId, messageId, change),
  pushMacroValues: () => pushMacroValues(),
  trackEvent,
});
const handleImportPresetFile = createImportService({
  hasEphemeralPermission: () => hasPermission("ephemeral_storage"),
  requestBlock: (bytes, options) => spindle.ephemeral.requestBlock(bytes, options),
  writeEphemeral: (path, text, options) => spindle.ephemeral.write(path, text, options),
  releaseBlock: (reservationId) => spindle.ephemeral.releaseBlock(reservationId),
  sendToFrontend: (message, userId) => spindle.sendToFrontend(message, userId),
  readConfig: () => config,
  writeConfig: (value) => { config = value; },
  saveConfig: (userId) => saveConfig(userId),
  pushMacroValues: () => pushMacroValues(),
  sendConfigState: (userId) => sendConfigState(userId),
  trackEvent,
});
const settingsStore = createSettingsStore({
  getJson: (path, options) => spindle.userStorage.getJson<Partial<TrackerConfig>>(path, options),
  setJson: (path, value, options) => spindle.userStorage.setJson(path, value, options),
  enclaveGet: (key, userId) => spindle.enclave.get(key, userId),
  enclavePut: (key, value, userId) => spindle.enclave.put(key, value, userId),
  enclaveDelete: (key, userId) => spindle.enclave.delete(key, userId),
  logError: (message) => spindle.log.error(message),
  logWarn: (message) => spindle.log.warn(message),
});

function hasPermission(name: string): boolean {
  return runtime.grantedPermissions.has(name);
}

async function trackEvent(
  eventName: string,
  payload?: Record<string, unknown>,
  options?: { level?: "debug" | "info" | "warn" | "error"; chatId?: string },
): Promise<void> {
  if (!hasPermission("event_tracking")) return;
  try {
    await spindle.events.track(eventName, payload, options);
  } catch {
    // Telemetry should never break runtime behavior.
  }
}

// ── Per-Chat Tracker History (side-channel) ──────────────────────────
//
// Maintains a backend-owned record of every tracker payload the extension
// has seen in each chat, keyed by message id. Populated from:
//   1. MESSAGE_TAG_INTERCEPTED — fires as soon as the frontend tag
//      interceptor observes a tracker tag, BEFORE `removeFromMessage`
//      has a chance to clear it from the canonical message content.
//   2. MESSAGE_SENT / MESSAGE_EDITED — fallback for messages whose
//      tracker blocks survived as code fences or tags in the content.
//   3. rehydrateChatTrackerHistory — initial scan of the current chat
//      on demand, so history is populated even for chats the extension
//      wasn't active in when the message was originally generated.

const { checkConceptionTriggers, commitForcedConception } = createConceptionGate({
  spindle,
  readConfig: () => config,
  hasPermission,
  typeSafeCorsTransport,
  trackEvent,
  getChatTrackerHistory,
});

const { registerMacros, pushMacroValues, buildExampleTrackerBlock, formatTrackerPayload } = createMacroPublisher({
  spindle,
  readConfig: () => config,
  getActivePreset,
  readFirstMessageFertilityHint: () => firstMessageFertilityHint,
  publishSelectedTracker,
});

async function loadConfig(userId: string): Promise<void> {
  config = await settingsStore.loadConfig(userId, (normalized) => { config = normalized; });
  loadedConfigUserId = userId;
  pushMacroValues();
}

async function ensureConfigForUser(userId?: string | null): Promise<void> {
  if (!userId) return;
  if (activeUserId === userId && loadedConfigUserId === userId) return;
  activeUserId = userId;
  await loadConfig(userId);
}

async function loadSeededTemplatePresets(): Promise<void> {
  if (runtime.seededPresetsLoaded) return;
  runtime.seededPresets = await discoverSeededPresets({
    exists: (path) => spindle.storage.exists(path),
    list: (path) => spindle.storage.list(path),
    stat: (path) => spindle.storage.stat(path),
    getJson: (path) => spindle.storage.getJson<Record<string, unknown>>(path, { fallback: {} }),
  });
  runtime.seededPresetsLoaded = true;
}

async function saveConfig(userId: string, configToSave: TrackerConfig = config): Promise<void> {
  await settingsStore.saveConfig(userId, configToSave);
}

async function syncTypeSafeKeyToEnclave(userId: string, nextKey: string, previousKey: string): Promise<void> {
  await settingsStore.syncTypeSafeKeyToEnclave(userId, nextKey, previousKey);
}


registerMessageEvents({
  spindle,
  readConfig: () => config,
  readActiveUserId: () => activeUserId,
  setActiveChatId: (value) => { activeChatId = value; },
  ensureConfigForUser,
  rehydrateChatTrackerHistory,
  handleSlashCommand,
  extractTrackerPayloadFromMessage,
  recordChatTracker,
  forgetChatTracker,
  pushMacroValues,
  trackEvent,
});

registerMacros();

const { enqueueSecondaryGeneration } = createSecondaryGeneration({
  spindle,
  readConfig: () => config,
  readActiveUserId: () => activeUserId,
  hasPermission,
  trackEvent,
  getActivePreset,
  buildExampleTrackerBlock,
  formatTrackerPayload,
  rehydrateChatTrackerHistory,
  extractTrackerPayloadFromMessage,
  getRecentChatTrackers,
  recordChatTracker,
  pushMacroValues,
  typeSafeCorsTransport,
});

registerChatLifecycleEvents({
  spindle,
  readConfig: () => config,
  ensureConfigForUser,
  isSelectedChatKnown: () => selectedChatKnown,
  selectChat,
  setActiveChatId: (value) => { activeChatId = value; },
  rehydrateChatTrackerHistory,
  getChatTrackerHistory,
  readFirstMessageFertilityHint: () => firstMessageFertilityHint,
  writeFirstMessageFertilityHint: (value) => { firstMessageFertilityHint = value; },
  pushMacroValues,
  forgetChatTracker,
  hasPermission,
  extractTrackerPayloadFromMessage,
  recordChatTracker,
  enqueueSecondaryGeneration,
});

const { tryRegisterInterceptor } = createPromptInterceptor({
  spindle,
  readConfig: () => config,
  readActiveChatId: () => activeChatId,
  hasPermission,
  trackerMessageCodec,
  rehydrateChatTrackerHistory,
  getRecentChatTrackers,
  getChatTrackerHistory,
  extractTrackerPayloadFromMessage,
  checkConceptionTriggers,
  commitForcedConception,
});

// Attempt initial interceptor registration
tryRegisterInterceptor();

async function initGrantedPermissions(): Promise<void> {
  try {
    const granted = await spindle.permissions.getGranted();
    runtime.grantedPermissions = new Set(granted);
    spindle.log.info(`Granted permissions: ${granted.join(", ") || "none"}`);
  } catch {
    runtime.grantedPermissions = new Set();
    spindle.log.warn("Unable to read granted permissions");
  }
}

async function refreshGrantedPermissions(): Promise<void> {
  try {
    const granted = await spindle.permissions.getGranted();
    runtime.grantedPermissions = new Set(granted);
  } catch {
    // Keep last known permissions snapshot.
  }
}

// ── Real-time Permission Gating ──────────────────────────────────────

spindle.permissions.onChanged(({ permission, granted, allGranted }) => {
  runtime.grantedPermissions = new Set(allGranted);
  spindle.log.info(
    `Permission "${permission}" ${granted ? "granted" : "revoked"} — active: ${allGranted.join(", ") || "none"}`,
  );

  // Re-register interceptor if it becomes available
  if (permission === "interceptor" && granted) {
    tryRegisterInterceptor();
  }

  // Push updated permission state to frontend
  spindle.sendToFrontend({
    type: "permission_changed",
    permission,
    granted,
    allGranted,
  }, activeUserId || undefined);
});

spindle.permissions.onDenied(({ permission, operation }) => {
  spindle.log.warn(`Permission "${permission}" denied for operation: ${operation}`);
});

async function getEphemeralPoolStatusSafe(): Promise<Record<string, unknown> | null> {
  if (!hasPermission("ephemeral_storage")) return null;
  try {
    return await spindle.ephemeral.getPoolStatus();
  } catch {
    return null;
  }
}

function sendConfigError(userId: string, message: string, operation: "load" | "save" = "load"): void {
  try {
    spindle.sendToFrontend({ type: "config_error", message, operation }, userId);
  } catch {
    // If frontend delivery itself fails, the backend log is the remaining signal.
  }
}

async function sendConfigState(userId: string, configToSend: TrackerConfig = config): Promise<void> {
  const [, ephemeralPoolStatus] = await Promise.all([
    loadSeededTemplatePresets(),
    (async () => {
      await refreshGrantedPermissions();
      return getEphemeralPoolStatusSafe();
    })(),
  ]);
  spindle.sendToFrontend({
    type: "config",
    config: configToSend,
    grantedPermissions: Array.from(runtime.grantedPermissions),
    requestedPermissions: spindle.manifest?.permissions || [],
    seededPresets: runtime.seededPresets,
    ephemeralPoolStatus,
  }, userId);
}

function sendTagInterceptorConfig(userId: string, configToSend: TrackerConfig = config): void {
  spindle.sendToFrontend({
    type: "tag_interceptor_config",
    tagName: configToSend.trackerTagName,
    tagType: configToSend.codeBlockIdentifier,
    removeFromMessage: configToSend.hideSimBlocks,
  }, userId);
}

spindle.onFrontendMessage(createFrontendMessageHandler({
  spindle,
  readConfig: () => config,
  writeConfig: (value) => { config = value; },
  setActiveUserId: (value) => { activeUserId = value; },
  setActiveChatId: (value) => { activeChatId = value; },
  isSelectedChatKnown: () => selectedChatKnown,
  readSelectedChatId: () => selectedChatId,
  selectChat,
  loadConfig,
  ensureConfigForUser,
  syncTypeSafeKeyToEnclave,
  saveConfig,
  pushMacroValues,
  trackEvent,
  sendConfigState,
  sendTagInterceptorConfig,
  sendConfigError,
  hasPermission,
  enqueueSecondaryGeneration,
  extractTrackerPayloadFromMessage,
  forgetChatTracker,
  rehydrateChatTrackerHistory,
  getChatTrackerHistory,
  handleImportPresetFile,
}));

await initGrantedPermissions();
spindle.log.info("Silly Sim Tracker (Lumiverse) backend started");

export {};
