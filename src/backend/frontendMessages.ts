import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG, type TrackerConfig } from "../shared/trackerConfig";
import { mergeTrackerConfig } from "./backendConfig";
import { buildTrackerFenceRegex, buildTrackerTagRegex, sanitizeTagName } from "../shared/trackerSyntax";
import { readWireMessage, readWireRecord, type BackendToFrontendMessage } from "../shared/wireMessages";

export function createFrontendMessageHandler(deps: {
  spindle: SpindleAPI;
  readConfig: () => TrackerConfig;
  writeConfig: (config: TrackerConfig) => void;
  setActiveUserId: (userId: string) => void;
  setActiveChatId: (chatId: string) => void;
  isSelectedChatKnown: () => boolean;
  readSelectedChatId: () => string | null;
  selectChat: (chatId: string | null) => void;
  loadConfig: (userId: string) => Promise<void>;
  ensureConfigForUser: (userId: string) => Promise<void>;
  syncTypeSafeKeyToEnclave: (userId: string, nextKey: string, previousKey: string) => Promise<void>;
  saveConfig: (userId: string) => Promise<void>;
  pushMacroValues: () => void;
  trackEvent: (eventName: string, payload?: Record<string, unknown>, options?: { level?: "debug" | "info" | "warn" | "error"; chatId?: string }) => Promise<void>;
  sendConfigState: (userId: string) => Promise<void>;
  sendTagInterceptorConfig: (userId: string) => void;
  sendConfigError: (userId: string, message: string, operation?: "load" | "save") => void;
  hasPermission: (name: string) => boolean;
  enqueueSecondaryGeneration: (chatId: string, messageId: string) => Promise<void>;
  extractTrackerPayloadFromMessage: (content: string) => string | null;
  forgetChatTracker: (chatId: string | null, messageId: string | null) => void;
  rehydrateChatTrackerHistory: (chatId: string | null) => Promise<void>;
  getChatTrackerHistory: (chatId: string | null) => Array<{ messageId: string; payload: string }>;
  handleImportPresetFile: (payload: Record<string, unknown>, userId: string) => Promise<void>;
}) {
  const {
    spindle,
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
    selectChat,
  } = deps;
return async (payload: unknown, userId: string) => {
  const message = readWireMessage(payload);
  if (!message) return;
  deps.setActiveUserId(userId);
  let config = deps.readConfig();

  if (message.type === "get_config") {
    try {
      await loadConfig(userId);
      // Unblock chat display before the heavier template/permission/status
      // bootstrap. The frontend can strip tags immediately and defer rendering
      // until the authoritative latest-tracker lookup completes.
      sendTagInterceptorConfig(userId);
      await sendConfigState(userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spindle.log.error(`get_config handler failed: ${msg}`);
      sendConfigError(userId, msg, "load");
    }
    return;
  }
  if (message.type === "set_config") {
    const incoming = readWireRecord(message.config);
    if (!incoming) {
      sendConfigError(userId, "Invalid settings payload.", "save");
      return;
    }
    try {
      await ensureConfigForUser(userId);
      config = deps.readConfig();
      const previousTypeSafeKey = config.typeSafeApiKey.trim();
      config = mergeTrackerConfig(config, incoming);
      deps.writeConfig(config);
      await syncTypeSafeKeyToEnclave(userId, config.typeSafeApiKey, previousTypeSafeKey);
      await saveConfig(userId);
      pushMacroValues();
      await trackEvent("sst.config.updated", {
        trackerTagName: config.trackerTagName,
        templateId: config.templateId,
        trackerFormat: config.trackerFormat,
        retainTrackerCount: config.retainTrackerCount,
        hideSimBlocks: config.hideSimBlocks,
        useSecondaryLLM: config.useSecondaryLLM,
      });
      await sendConfigState(userId);
      spindle.sendToFrontend({ type: "config_saved" } satisfies BackendToFrontendMessage, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spindle.log.error(`set_config handler failed for user ${userId}: ${msg}`);
      sendConfigError(userId, msg, "save");
    }
    return;
  }

  if (message.type === "get_connections") {
    if (!hasPermission("generation")) {
      spindle.log.warn("get_connections: 'generation' permission not granted");
      spindle.sendToFrontend({
        type: "connections_list",
        connections: [],
        error: "Generation permission not granted",
      } satisfies BackendToFrontendMessage, userId);
      return;
    }
    try {
      spindle.log.info(`get_connections: requesting with userId=${userId || "(none)"}`);
      const connections = await spindle.connections.list(userId || undefined);
      spindle.log.info(`get_connections: received ${connections?.length ?? 0} connection(s)`);
      spindle.sendToFrontend({ type: "connections_list", connections: connections ?? [] } satisfies BackendToFrontendMessage, userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spindle.log.error(`get_connections failed: ${msg}`);
      spindle.sendToFrontend({ type: "connections_list", connections: [], error: msg } satisfies BackendToFrontendMessage, userId);
    }
    return;
  }

  if (message.type === "trigger_secondary_generation") {
    const chatId = typeof message.chatId === "string" ? message.chatId : null;
    const messageId = typeof message.messageId === "string" ? message.messageId : null;
    if (chatId && messageId) {
      void enqueueSecondaryGeneration(chatId, messageId);
    }
    return;
  }

  if (message.type === "regenerate_secondary_tracker") {
    const chatId = typeof message.chatId === "string" ? message.chatId : null;
    const hintedMessageId = typeof message.messageId === "string" ? message.messageId : null;
    if (!chatId) return;
    if (!hasPermission("chat_mutation")) {
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: "Regenerate requires 'chat_mutation' permission" } satisfies BackendToFrontendMessage,
        userId,
      );
      return;
    }

    const messages = await spindle.chat.getMessages(chatId);
    let target = hintedMessageId
      ? messages.find((m) => m.id === hintedMessageId && m.role === "assistant") || null
      : null;
    // Fall back to the most recent assistant message — whether or not it
    // already carries a tracker — so the user can ask for a fresh generation
    // even on a message that's never been processed yet.
    if (!target) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === "assistant") {
          target = messages[i];
          break;
        }
      }
    }
    if (!target) {
      spindle.sendToFrontend(
        { type: "secondary_generation_error", message: "No assistant message was found in this chat to regenerate." } satisfies BackendToFrontendMessage,
        userId,
      );
      return;
    }

    const tagRe = buildTrackerTagRegex(sanitizeTagName(config.trackerTagName), "gi");
    const fenceRe = buildTrackerFenceRegex(config.codeBlockIdentifier, "gi");
    const hadTracker = extractTrackerPayloadFromMessage(target.content) !== null;
    if (hadTracker) {
      const stripped = target.content.replace(tagRe, "").replace(fenceRe, "").replace(/\n{3,}/g, "\n\n").trimEnd();
      spindle.log.info(`Regenerate: stripping existing tracker from message ${target.id} in chat ${chatId}`);
      await spindle.chat.updateMessage(chatId, target.id, { content: stripped });
      forgetChatTracker(chatId, target.id);
    } else {
      spindle.log.info(`Regenerate: message ${target.id} in chat ${chatId} has no tracker yet — generating fresh`);
    }

    void enqueueSecondaryGeneration(chatId, target.id);
    return;
  }

  if (message.type === "get_latest_tracker") {
    const chatId = typeof message.chatId === "string" ? message.chatId : null;
    if (!chatId) {
      if (!deps.isSelectedChatKnown()) selectChat(null);
      spindle.sendToFrontend({ type: "tracker_history_latest", chatId: null, entry: null } satisfies BackendToFrontendMessage, userId);
      return;
    }
    // A lookup can arrive after a chat switch; only use it to identify the
    // selected chat before the host has supplied that identity itself.
    if (!deps.isSelectedChatKnown()) selectChat(chatId);
    if (deps.readSelectedChatId() === chatId) deps.setActiveChatId(chatId);
    await rehydrateChatTrackerHistory(chatId);
    const history = getChatTrackerHistory(chatId);
    const entry = history.length > 0 ? history[history.length - 1] : null;
    const previousEntry = history.length > 1 ? history[history.length - 2] : null;
    spindle.sendToFrontend({
      type: "tracker_history_latest",
      chatId,
      entry: entry
        ? {
            messageId: entry.messageId,
            payload: entry.payload,
            previousPayload: previousEntry?.payload || null,
          }
        : null,
    } satisfies BackendToFrontendMessage, userId);
    return;
  }

  if (message.type === "remove_inline_pack") {
    const index = typeof message.index === "number" ? message.index : -1;
    if (index >= 0 && index < config.inlinePacks.length) {
      const next = config.inlinePacks.slice();
      next.splice(index, 1);
      config = { ...config, inlinePacks: next };
      deps.writeConfig(config);
      await saveConfig(userId);
      pushMacroValues();
      await sendConfigState(userId);
    }
    return;
  }

  if (message.type === "toggle_inline_pack") {
    const index = typeof message.index === "number" ? message.index : -1;
    const enabled = typeof message.enabled === "boolean" ? message.enabled : true;
    if (index >= 0 && index < config.inlinePacks.length) {
      const next = config.inlinePacks.slice();
      next[index] = { ...readWireRecord(next[index]), enabled };
      config = { ...config, inlinePacks: next };
      deps.writeConfig(config);
      await saveConfig(userId);
      pushMacroValues();
      await sendConfigState(userId);
    }
    return;
  }

  if (message.type === "delete_preset") {
    await ensureConfigForUser(userId);
    config = deps.readConfig();
    const templateId = typeof message.templateId === "string" ? message.templateId : "";
    const preset = config.userPresets.find((item) => item.id === templateId);
    if (!preset) {
      spindle.sendToFrontend({ type: "delete_preset_result", ok: false, message: "Only imported templates can be deleted." } satisfies BackendToFrontendMessage, userId);
      return;
    }
    const previousConfig = config;
    config = {
      ...config,
      userPresets: config.userPresets.filter((item) => item.id !== templateId),
      templateId: config.templateId === templateId ? DEFAULT_CONFIG.templateId : config.templateId,
    };
    deps.writeConfig(config);
    try {
      await saveConfig(userId);
    } catch (err) {
      config = previousConfig;
      deps.writeConfig(config);
      const detail = err instanceof Error ? err.message : String(err);
      spindle.log.error(`delete_preset failed: ${detail}`);
      spindle.sendToFrontend({ type: "delete_preset_result", ok: false, message: `Could not delete template: ${detail}` } satisfies BackendToFrontendMessage, userId);
      return;
    }
    pushMacroValues();
    await sendConfigState(userId);
    spindle.sendToFrontend({ type: "delete_preset_result", ok: true, message: `Deleted template: ${preset.templateName}` } satisfies BackendToFrontendMessage, userId);
    return;
  }

  if (message.type === "import_preset_file") {
    await handleImportPresetFile(message, userId);
  }
};
}
