import type { SpindleFrontendContext, SpindleModelComboboxHandle } from "lumiverse-spindle-types";
import type { TrackerConfig } from "../shared/trackerConfig";
import type { PendingTrackerPayload } from "./trackerRendering";

export type ConnectionProfile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  is_default: boolean;
  has_api_key: boolean;
};

export function createFrontendControls(deps: {
  ctx: SpindleFrontendContext;
  byId: <T extends Element>(id: string) => T | null;
  state: {
    removeHideStyle: (() => void) | null;
    removeTagInterceptor: (() => void) | null;
    tagInterceptorSignature: string | null;
    modelCombobox: SpindleModelComboboxHandle | null;
    pendingTrackerPayload: PendingTrackerPayload | null;
  };
  readConfig: () => TrackerConfig;
  writeConfig: (config: TrackerConfig) => void;
  readConnections: () => ConnectionProfile[];
  readGrantedPermissions: () => string[];
  readCurrentChatId: () => string | null;
  readLatestTrackerMessageId: () => string | null;
  isConfigReady: () => boolean;
  readAwaitingLatestTrackerChatId: () => string | null;
  isActivityForActiveChat: (chatId: string | null) => boolean;
  handleTrackerPayload: (raw: string, sourceContent: string, messageId: string | null) => void;
  mountTemplateOptions: (config: TrackerConfig) => void;
  isImportedTemplate: (config: TrackerConfig, id: string) => boolean;
}) {
  const { ctx, byId, state, mountTemplateOptions, isImportedTemplate } = deps;
  const applyHideStyle = () => {
    if (state.removeHideStyle) {
      state.removeHideStyle();
      state.removeHideStyle = null;
    }
    state.removeHideStyle = ctx.dom.addStyle(
      `pre[data-code-lang="${deps.readConfig().codeBlockIdentifier}"] { display: ${deps.readConfig().hideSimBlocks ? "none" : "block"} !important; }`,
    );
  };

  const buildConnectionRef = (connectionId: string) =>
    connectionId
      ? ({ kind: "llm", id: connectionId } as const)
      : ({ kind: "llm" } as const);

  const ensureModelCombobox = () => {
    if (state.modelCombobox) return state.modelCombobox;
    const mount = byId<HTMLElement>("sst-lumi-llm-model-mount");
    if (!mount) return null;
    state.modelCombobox = ctx.components.mountModelCombobox(mount, {
      value: deps.readConfig().secondaryLLMModel,
      connection: buildConnectionRef(deps.readConfig().secondaryLLMConnectionId),
      appearance: "standard",
      placeholder: "Leave empty to use connection default",
      browseHint: "Search the connection's catalog",
      onChange: (value) => {
        deps.writeConfig({ ...deps.readConfig(), secondaryLLMModel: value });
      },
    });
    return state.modelCombobox;
  };

  const populateConnectionDropdown = () => {
    const select = byId<HTMLSelectElement>("sst-lumi-llm-connection");
    if (!select) return;
    select.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = deps.readConnections().length ? "Use default connection" : "No connections available";
    select.appendChild(emptyOption);
    for (const conn of deps.readConnections()) {
      const option = document.createElement("option");
      option.value = conn.id;
      option.textContent = `${conn.name} (${conn.provider}${conn.model ? " / " + conn.model : ""})${conn.is_default ? " [default]" : ""}`;
      select.appendChild(option);
    }
    if (deps.readConfig().secondaryLLMConnectionId) {
      select.value = deps.readConfig().secondaryLLMConnectionId;
    }
    ensureModelCombobox()?.update({
      connection: buildConnectionRef(deps.readConfig().secondaryLLMConnectionId),
    });
  };

  const setLLMStatus = (text: string, type: "" | "generating" | "error" = "") => {
    const el = byId<HTMLElement>("sst-lumi-llm-status");
    if (!el) return;
    el.textContent = text;
    el.className = "sst-lumi-llm-status" + (type ? ` sst-${type}` : "");
  };

  const hasPermission = (name: string): boolean => deps.readGrantedPermissions().includes(name);

  const updateRegenerateButton = () => {
    const btn = byId<HTMLButtonElement>("sst-lumi-llm-regenerate");
    if (!btn) return;
    const llmAvailable =
      hasPermission("generation") && hasPermission("chat_mutation") && hasPermission("generation_parameters");
    btn.disabled = !(deps.readConfig().useSecondaryLLM && llmAvailable && deps.readCurrentChatId());
    btn.title = btn.disabled
      ? "Regenerate becomes available once a chat is open and the secondary LLM is enabled"
      : deps.readLatestTrackerMessageId()
        ? "Strip the existing tracker block and ask the secondary LLM to produce a fresh one"
        : "Run the secondary LLM against the latest assistant message";
  };

  const updatePermissionGatedControls = () => {
    const llmSection = byId<HTMLDetailsElement>("sst-lumi-llm-section");
    const llmEnable = byId<HTMLInputElement>("sst-lumi-llm-enable");
    if (llmSection) {
      const genGranted = hasPermission("generation");
      const mutGranted = hasPermission("chat_mutation");
      const paramsGranted = hasPermission("generation_parameters");
      const llmAvailable = genGranted && mutGranted && paramsGranted;
      llmSection.classList.toggle("sst-disabled", !llmAvailable);
      if (llmEnable) llmEnable.disabled = !llmAvailable;
      if (!llmAvailable) {
        const missing: string[] = [];
        if (!genGranted) missing.push("generation");
        if (!mutGranted) missing.push("chat_mutation");
        if (!paramsGranted) missing.push("generation_parameters");
        setLLMStatus(`Requires permission: ${missing.join(", ")}`, "error");
      }
    }
    updateRegenerateButton();
  };

  const applyTagInterceptor = () => {
    const signature = JSON.stringify([
      deps.readConfig().trackerTagName,
      deps.readConfig().codeBlockIdentifier,
      deps.readConfig().hideSimBlocks,
    ]);
    if (state.removeTagInterceptor && state.tagInterceptorSignature === signature) return;
    if (state.removeTagInterceptor) {
      state.removeTagInterceptor();
      state.removeTagInterceptor = null;
    }
    state.removeTagInterceptor = ctx.messages.registerTagInterceptor(
      {
        tagName: deps.readConfig().trackerTagName,
        attrs: { type: deps.readConfig().codeBlockIdentifier },
        removeFromMessage: deps.readConfig().hideSimBlocks,
      },
      (payload) => {
        const payloadChatId = payload.chatId || null;
        // Tag interception also runs for chats generating in the background.
        // Removing the raw tag is global host behavior, but rendering it is
        // only valid for the chat the user is actually viewing. In particular,
        // a background payload must never be treated as navigation: doing so
        // calls resetChatState() and uninjects the visible chat's tracker.
        if (!deps.isActivityForActiveChat(payloadChatId)) return;
        if (typeof payload.content !== "string" || !payload.content.trim()) return;
        const sourceContent = typeof payload.fullMatch === "string" ? payload.fullMatch : payload.content;
        const messageId = payload.messageId || null;
        // Initial chat hydration may mount dozens of historical tracker tags.
        // They still get stripped, but only the backend-selected latest match
        // is parsed/rendered and bridged back after rehydration.
        if (!deps.isConfigReady() || (!!payloadChatId && deps.readAwaitingLatestTrackerChatId() === payloadChatId)) {
          // A late historical mount must not replace the backend-selected
          // latest entry if that response won the race with full deps.readConfig().
          if (!state.pendingTrackerPayload?.authoritative) {
            state.pendingTrackerPayload = {
              raw: payload.content,
              sourceContent,
              messageId,
              chatId: payloadChatId || null,
              authoritative: false,
            };
          }
          return;
        }
        deps.handleTrackerPayload(
          payload.content,
          sourceContent,
          messageId,
        );
        ctx.sendToBackend({
          type: "message_tag_intercepted",
          tagName: payload.tagName,
          attrs: payload.attrs,
          content: payload.content,
          messageId: payload.messageId,
          chatId: payload.chatId,
          isStreaming: payload.isStreaming,
        });
      },
    );
    state.tagInterceptorSignature = signature;
  };

  const syncControls = () => {
    mountTemplateOptions(deps.readConfig());
    const templateSelect = byId<HTMLSelectElement>("sst-lumi-template");
    const deleteTemplateButton = byId<HTMLButtonElement>("sst-lumi-delete-template");
    const tagInput = byId<HTMLInputElement>("sst-lumi-tag");
    const identifierInput = byId<HTMLInputElement>("sst-lumi-identifier");
    const hideInput = byId<HTMLInputElement>("sst-lumi-hide");
    const inlineInput = byId<HTMLInputElement>("sst-lumi-inline");
    const formatSelect = byId<HTMLSelectElement>("sst-lumi-format");
    const retainInput = byId<HTMLInputElement>("sst-lumi-retain");
    if (templateSelect) templateSelect.value = deps.readConfig().templateId;
    if (deleteTemplateButton) deleteTemplateButton.disabled = !isImportedTemplate(deps.readConfig(), deps.readConfig().templateId);
    if (tagInput) tagInput.value = deps.readConfig().trackerTagName;
    if (identifierInput) identifierInput.value = deps.readConfig().codeBlockIdentifier;
    if (hideInput) hideInput.checked = deps.readConfig().hideSimBlocks;
    if (inlineInput) inlineInput.checked = deps.readConfig().enableInlineTemplates;
    if (formatSelect) formatSelect.value = deps.readConfig().trackerFormat;
    if (retainInput) retainInput.value = String(deps.readConfig().retainTrackerCount);

    const cycleBiasSelect = byId<HTMLSelectElement>("sst-lumi-cycle-bias");
    if (cycleBiasSelect) cycleBiasSelect.value = deps.readConfig().fertilityCycleBias;

    const llmEnable = byId<HTMLInputElement>("sst-lumi-llm-enable");
    const llmMsgCount = byId<HTMLInputElement>("sst-lumi-llm-msgcount");
    const llmTemp = byId<HTMLInputElement>("sst-lumi-llm-temp");
    const llmStrip = byId<HTMLInputElement>("sst-lumi-llm-strip");
    if (llmEnable) llmEnable.checked = deps.readConfig().useSecondaryLLM;
    if (llmMsgCount) llmMsgCount.value = String(deps.readConfig().secondaryLLMMessageCount);
    if (llmTemp) llmTemp.value = String(deps.readConfig().secondaryLLMTemperature);
    if (llmStrip) llmStrip.checked = deps.readConfig().secondaryLLMStripHTML;
    const tsEnable = byId<HTMLInputElement>("sst-lumi-ts-enable");
    const tsKey = byId<HTMLInputElement>("sst-lumi-ts-key");
    const tsModel = byId<HTMLInputElement>("sst-lumi-ts-model");
    const tsQuick = byId<HTMLInputElement>("sst-lumi-ts-quick");
    const tsVerify = byId<HTMLInputElement>("sst-lumi-ts-verify");
    const tsConception = byId<HTMLInputElement>("sst-lumi-ts-conception");
    const tsConfidence = byId<HTMLInputElement>("sst-lumi-ts-confidence");
    if (tsEnable) tsEnable.checked = deps.readConfig().typeSafeEnabled;
    if (tsKey) tsKey.value = deps.readConfig().typeSafeApiKey;
    if (tsModel) tsModel.value = deps.readConfig().typeSafeModel;
    if (tsQuick) tsQuick.checked = deps.readConfig().typeSafeQuickAppend;
    if (tsVerify) tsVerify.checked = deps.readConfig().typeSafeVerify;
    if (tsConception) tsConception.checked = deps.readConfig().typeSafeConception;
    if (tsConfidence) tsConfidence.value = String(deps.readConfig().typeSafeConfidenceFloor);
    populateConnectionDropdown();
    ensureModelCombobox()?.update({ value: deps.readConfig().secondaryLLMModel });
    updateRegenerateButton();
    renderInlinePacksList();
  };

  const renderInlinePacksList = () => {
    const list = byId<HTMLElement>("sst-lumi-packs-list");
    const countLabel = byId<HTMLElement>("sst-lumi-packs-count");
    if (!list) return;
    list.innerHTML = "";
    const packs = deps.readConfig().inlinePacks;
    if (countLabel) countLabel.textContent = `(${packs.length})`;
    for (let i = 0; i < packs.length; i += 1) {
      const pack = packs[i] as Record<string, unknown>;
      const enabled = pack.enabled !== false;
      const name = typeof pack.templateName === "string" && pack.templateName.trim() ? pack.templateName : "Unnamed pack";
      const author = typeof pack.templateAuthor === "string" && pack.templateAuthor.trim() ? pack.templateAuthor : "Unknown";
      const templateCount = Array.isArray(pack.inlineTemplates) ? pack.inlineTemplates.length : 0;

      const row = document.createElement("div");
      row.className = `sst-lumi-pack-row${enabled ? "" : " sst-pack-disabled"}`;

      const info = document.createElement("div");
      info.className = "sst-lumi-pack-info";
      const nameEl = document.createElement("div");
      nameEl.className = "sst-lumi-pack-name";
      nameEl.textContent = name;
      const metaEl = document.createElement("div");
      metaEl.className = "sst-lumi-pack-meta";
      metaEl.textContent = `by ${author} · ${templateCount} template${templateCount === 1 ? "" : "s"}`;
      info.append(nameEl, metaEl);

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "sst-lumi-pack-toggle";
      const toggleInput = document.createElement("input");
      toggleInput.type = "checkbox";
      toggleInput.checked = enabled;
      toggleInput.addEventListener("change", () => {
        ctx.sendToBackend({ type: "toggle_inline_pack", index: i, enabled: toggleInput.checked });
      });
      const toggleText = document.createElement("span");
      toggleText.textContent = "Enabled";
      toggleLabel.append(toggleInput, toggleText);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "sst-lumi-pack-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        ctx.sendToBackend({ type: "remove_inline_pack", index: i });
      });

      row.append(info, toggleLabel, removeBtn);
      list.appendChild(row);
    }
  };

  return { applyHideStyle, buildConnectionRef, ensureModelCombobox, populateConnectionDropdown, setLLMStatus, hasPermission, updateRegenerateButton, updatePermissionGatedControls, applyTagInterceptor, syncControls, renderInlinePacksList };
}
