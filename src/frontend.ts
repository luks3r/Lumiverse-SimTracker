import type { SpindleFrontendContext, SpindleModelComboboxHandle } from "lumiverse-spindle-types";
import { getTemplatePresets, mergeTemplatePresets, type TemplatePreset } from "./templatePresets";
import { parseTrackerBlock, type TrackerData } from "./trackerData";
import { createReadyGate } from "./frontendReadyGate";
import { resolveTrackerMountMode, type TrackerMountMode } from "./frontendTemplate";
import { buildTrackerMarkup } from "./frontendTemplateRenderer";
import { CONFIG_ERROR_STATUS_PREFIX, DEFAULT_PANEL_STATUS, LOADING_CONFIG_STATUS, PANEL_CSS, PANEL_HTML } from "./frontendPanel";
import { registerTemplateHelpers } from "./frontendTemplateHelpers";
import { createInlineTemplateProcessor } from "./inlineTemplates";
import { DEFAULT_CONFIG, FERTILITY_CYCLE_BIAS_VALUES, type FertilityCycleBias, type TrackerConfig } from "./trackerConfig";
import { createFrontendMessageSyntax, readMessageContext } from "./frontendMessageSyntax";
import { sanitizeIdentifier, sanitizeTagName } from "./trackerSyntax";
import { buildSavedFrontendConfig } from "./frontendSettingsValues";

type ConnectionProfile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  is_default: boolean;
  has_api_key: boolean;
};


const BUILTIN_PRESETS = getTemplatePresets();
let runtimeSeededPresets: TemplatePreset[] = [];
let panelRoot: Element | null = null;
function byId<T extends Element>(id: string): T | null {
  const scoped = panelRoot?.querySelector(`#${id}`) as T | null;
  if (scoped) return scoped;
  return document.getElementById(id) as T | null;
}

function getAllPresets(config: TrackerConfig): TemplatePreset[] {
  return mergeTemplatePresets(BUILTIN_PRESETS, runtimeSeededPresets, config.userPresets);
}

function getPresetById(config: TrackerConfig, id: string): TemplatePreset {
  return getAllPresets(config).find((preset) => preset.id === id) || BUILTIN_PRESETS[0];
}

let configTrackerTagNameHint = "tracker";
const { extractTrackerBlock } = createFrontendMessageSyntax(() => configTrackerTagNameHint);

function setStatus(text: string): void {
  const el = byId<HTMLElement>("sst-lumi-status");
  if (el) el.textContent = text;
}

function shouldResetStatusAfterConfigLoad(): boolean {
  const text = byId<HTMLElement>("sst-lumi-status")?.textContent?.trim() || "";
  return !text || text === LOADING_CONFIG_STATUS || text.startsWith(CONFIG_ERROR_STATUS_PREFIX);
}

function renderCapabilities(
  grantedPermissions: string[],
  requestedPermissions: string[],
  ephemeralPoolStatus: Record<string, unknown> | null,
): void {
  const perms = grantedPermissions.length ? grantedPermissions.join(", ") : "none";
  const missing = requestedPermissions.filter((p) => !grantedPermissions.includes(p));
  const missingText = missing.length ? ` | missing: ${missing.join(", ")}` : "";
  const extAvail = typeof ephemeralPoolStatus?.extensionAvailableBytes === "number"
    ? ` | ephemeral available: ${ephemeralPoolStatus.extensionAvailableBytes} bytes`
    : "";
  const text = `Capabilities: ${perms}${missingText}${extAvail}`;
  const el = byId<HTMLElement>("sst-lumi-capabilities");
  if (el) el.textContent = text;
}

function renderEmpty(message: string): void {
  const body = byId<HTMLElement>("sst-lumi-body");
  if (!body) return;
  body.innerHTML = "";
  const p = document.createElement("p");
  p.className = "sst-lumi-raw";
  p.textContent = message;
  body.appendChild(p);
}

function applyThemeClass(preset: TemplatePreset): void {
  const panel = byId<HTMLElement>("sst-lumi-panel");
  if (!panel) return;
  panel.classList.remove("sst-theme-dating", "sst-theme-tactical");
  if (preset.id.includes("tactical")) panel.classList.add("sst-theme-tactical");
  else if (preset.id.includes("dating")) panel.classList.add("sst-theme-dating");
}

function renderTracker(
  data: TrackerData,
  raw: string,
  preset: TemplatePreset,
  previousData: TrackerData | null,
  injectSanitized: (html: string) => void,
): void {
  const body = byId<HTMLElement>("sst-lumi-body");
  if (!body) return;
  body.innerHTML = "";

  const markup = buildTrackerMarkup(data, preset, previousData);
  if (!markup.html) {
    renderEmpty(raw);
    return;
  }
  injectSanitized(markup.html);
}

function showCommandResult(payload: Record<string, unknown>): void {
  const panel = byId<HTMLElement>("sst-lumi-command");
  if (!panel) return;

  const ok = Boolean(payload.ok);
  const message = typeof payload.message === "string" ? payload.message : "";
  const block = typeof payload.block === "string" ? payload.block : "";

  if (!message && !block) {
    panel.style.display = "none";
    panel.innerHTML = "";
    return;
  }

  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  panel.style.display = "grid";
  panel.innerHTML = `
    <div style="font-size:11px;color:${ok ? "var(--lumiverse-text)" : "#ff6b6b"};">${escaped}</div>
    ${block ? `<textarea id="sst-lumi-command-block" readonly></textarea><button id="sst-lumi-copy-block" type="button">Copy Block</button>` : ""}
  `;

  if (block) {
    const textarea = byId<HTMLTextAreaElement>("sst-lumi-command-block");
    if (textarea) textarea.value = block;
    const copyBtn = byId<HTMLElement>("sst-lumi-copy-block");
    copyBtn?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(block);
      } catch {
        if (textarea) {
          textarea.focus();
          textarea.select();
        }
      }
    });
  }
}

function mountTemplateOptions(config: TrackerConfig): void {
  const select = byId<HTMLSelectElement>("sst-lumi-template");
  if (!select) return;
  select.innerHTML = "";
  const presets = getAllPresets(config);
  for (const preset of presets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.templateName;
    select.appendChild(option);
  }
  if (presets.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No templates available";
    select.appendChild(option);
  }
}

function downloadJson(filename: string, content: unknown): void {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
  let sideAppMount: { mount: any; side: string } | null = null;
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

  panelRoot = ctx.dom.inject(mountRoot, PANEL_HTML, "beforeend");
  renderCapabilities([], [], null);
  mountTemplateOptions(config);

  const applyHideStyle = () => {
    if (removeHideStyle) {
      removeHideStyle();
      removeHideStyle = null;
    }
    removeHideStyle = ctx.dom.addStyle(
      `pre[data-code-lang="${config.codeBlockIdentifier}"] { display: ${config.hideSimBlocks ? "none" : "block"} !important; }`,
    );
  };

  const buildConnectionRef = (connectionId: string) =>
    connectionId
      ? ({ kind: "llm", id: connectionId } as const)
      : ({ kind: "llm" } as const);

  const ensureModelCombobox = () => {
    if (modelCombobox) return modelCombobox;
    const mount = byId<HTMLElement>("sst-lumi-llm-model-mount");
    if (!mount) return null;
    modelCombobox = ctx.components.mountModelCombobox(mount, {
      value: config.secondaryLLMModel,
      connection: buildConnectionRef(config.secondaryLLMConnectionId),
      appearance: "standard",
      placeholder: "Leave empty to use connection default",
      browseHint: "Search the connection's catalog",
      onChange: (value) => {
        config = { ...config, secondaryLLMModel: value };
      },
    });
    return modelCombobox;
  };

  const populateConnectionDropdown = () => {
    const select = byId<HTMLSelectElement>("sst-lumi-llm-connection");
    if (!select) return;
    select.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = connections.length ? "Use default connection" : "No connections available";
    select.appendChild(emptyOption);
    for (const conn of connections) {
      const option = document.createElement("option");
      option.value = conn.id;
      option.textContent = `${conn.name} (${conn.provider}${conn.model ? " / " + conn.model : ""})${conn.is_default ? " [default]" : ""}`;
      select.appendChild(option);
    }
    if (config.secondaryLLMConnectionId) {
      select.value = config.secondaryLLMConnectionId;
    }
    ensureModelCombobox()?.update({
      connection: buildConnectionRef(config.secondaryLLMConnectionId),
    });
  };

  const setLLMStatus = (text: string, type: "" | "generating" | "error" = "") => {
    const el = byId<HTMLElement>("sst-lumi-llm-status");
    if (!el) return;
    el.textContent = text;
    el.className = "sst-lumi-llm-status" + (type ? ` sst-${type}` : "");
  };

  const hasPermission = (name: string): boolean => grantedPermissions.includes(name);

  const updateRegenerateButton = () => {
    const btn = byId<HTMLButtonElement>("sst-lumi-llm-regenerate");
    if (!btn) return;
    const llmAvailable =
      hasPermission("generation") && hasPermission("chat_mutation") && hasPermission("generation_parameters");
    btn.disabled = !(config.useSecondaryLLM && llmAvailable && currentChatId);
    btn.title = btn.disabled
      ? "Regenerate becomes available once a chat is open and the secondary LLM is enabled"
      : latestTrackerMessageId
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
      config.trackerTagName,
      config.codeBlockIdentifier,
      config.hideSimBlocks,
    ]);
    if (removeTagInterceptor && tagInterceptorSignature === signature) return;
    if (removeTagInterceptor) {
      removeTagInterceptor();
      removeTagInterceptor = null;
    }
    removeTagInterceptor = ctx.messages.registerTagInterceptor(
      {
        tagName: config.trackerTagName,
        attrs: { type: config.codeBlockIdentifier },
        removeFromMessage: config.hideSimBlocks,
      },
      (payload) => {
        const payloadChatId = payload.chatId || null;
        // Tag interception also runs for chats generating in the background.
        // Removing the raw tag is global host behavior, but rendering it is
        // only valid for the chat the user is actually viewing. In particular,
        // a background payload must never be treated as navigation: doing so
        // calls resetChatState() and uninjects the visible chat's tracker.
        if (!isActivityForActiveChat(payloadChatId)) return;
        if (typeof payload.content !== "string" || !payload.content.trim()) return;
        const sourceContent = typeof payload.fullMatch === "string" ? payload.fullMatch : payload.content;
        const messageId = payload.messageId || null;
        // Initial chat hydration may mount dozens of historical tracker tags.
        // They still get stripped, but only the backend-selected latest match
        // is parsed/rendered and bridged back after rehydration.
        if (!configReady || (!!payloadChatId && awaitingLatestTrackerChatId === payloadChatId)) {
          // A late historical mount must not replace the backend-selected
          // latest entry if that response won the race with full config.
          if (!pendingTrackerPayload?.authoritative) {
            pendingTrackerPayload = {
              raw: payload.content,
              sourceContent,
              messageId,
              chatId: payloadChatId || null,
              authoritative: false,
            };
          }
          return;
        }
        handleTrackerPayload(
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
    tagInterceptorSignature = signature;
  };

  const syncControls = () => {
    mountTemplateOptions(config);
    const templateSelect = byId<HTMLSelectElement>("sst-lumi-template");
    const tagInput = byId<HTMLInputElement>("sst-lumi-tag");
    const identifierInput = byId<HTMLInputElement>("sst-lumi-identifier");
    const hideInput = byId<HTMLInputElement>("sst-lumi-hide");
    const inlineInput = byId<HTMLInputElement>("sst-lumi-inline");
    const formatSelect = byId<HTMLSelectElement>("sst-lumi-format");
    const retainInput = byId<HTMLInputElement>("sst-lumi-retain");
    if (templateSelect) templateSelect.value = config.templateId;
    if (tagInput) tagInput.value = config.trackerTagName;
    if (identifierInput) identifierInput.value = config.codeBlockIdentifier;
    if (hideInput) hideInput.checked = config.hideSimBlocks;
    if (inlineInput) inlineInput.checked = config.enableInlineTemplates;
    if (formatSelect) formatSelect.value = config.trackerFormat;
    if (retainInput) retainInput.value = String(config.retainTrackerCount);

    const cycleBiasSelect = byId<HTMLSelectElement>("sst-lumi-cycle-bias");
    if (cycleBiasSelect) cycleBiasSelect.value = config.fertilityCycleBias;

    const llmEnable = byId<HTMLInputElement>("sst-lumi-llm-enable");
    const llmMsgCount = byId<HTMLInputElement>("sst-lumi-llm-msgcount");
    const llmTemp = byId<HTMLInputElement>("sst-lumi-llm-temp");
    const llmStrip = byId<HTMLInputElement>("sst-lumi-llm-strip");
    if (llmEnable) llmEnable.checked = config.useSecondaryLLM;
    if (llmMsgCount) llmMsgCount.value = String(config.secondaryLLMMessageCount);
    if (llmTemp) llmTemp.value = String(config.secondaryLLMTemperature);
    if (llmStrip) llmStrip.checked = config.secondaryLLMStripHTML;
    const tsEnable = byId<HTMLInputElement>("sst-lumi-ts-enable");
    const tsKey = byId<HTMLInputElement>("sst-lumi-ts-key");
    const tsModel = byId<HTMLInputElement>("sst-lumi-ts-model");
    const tsQuick = byId<HTMLInputElement>("sst-lumi-ts-quick");
    const tsVerify = byId<HTMLInputElement>("sst-lumi-ts-verify");
    const tsConception = byId<HTMLInputElement>("sst-lumi-ts-conception");
    const tsConfidence = byId<HTMLInputElement>("sst-lumi-ts-confidence");
    if (tsEnable) tsEnable.checked = config.typeSafeEnabled;
    if (tsKey) tsKey.value = config.typeSafeApiKey;
    if (tsModel) tsModel.value = config.typeSafeModel;
    if (tsQuick) tsQuick.checked = config.typeSafeQuickAppend;
    if (tsVerify) tsVerify.checked = config.typeSafeVerify;
    if (tsConception) tsConception.checked = config.typeSafeConception;
    if (tsConfidence) tsConfidence.value = String(config.typeSafeConfidenceFloor);
    populateConnectionDropdown();
    ensureModelCombobox()?.update({ value: config.secondaryLLMModel });
    updateRegenerateButton();
    renderInlinePacksList();
  };

  const renderInlinePacksList = () => {
    const list = byId<HTMLElement>("sst-lumi-packs-list");
    const countLabel = byId<HTMLElement>("sst-lumi-packs-count");
    if (!list) return;
    list.innerHTML = "";
    const packs = config.inlinePacks;
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

  const injectIntoPanelBody = (html: string) => {
    const panelBody = byId<HTMLElement>("sst-lumi-body");
    if (!panelBody || !panelBody.isConnected) return;
    ctx.dom.inject(panelBody, html, "beforeend");
  };

  const clearMessageTrackerRender = (messageId: string) => {
    const mount = trackerMessageMounts.get(messageId);
    if (mount) {
      ctx.dom.uninject(mount);
      trackerMessageMounts.delete(messageId);
    }
    trackerMessageRenders.delete(messageId);
  };

  // Source of truth is the host's chat-data store via getLatestMessageId(),
  // not DOM order — DOM only reflects the virtualizer's current window, so
  // the visually-last bubble can be a mid-chat message scrolled to bottom.
  const pruneNonLatestMessageTrackers = () => {
    const latestId = ctx.messages.getLatestMessageId();
    if (!latestId) return;
    for (const [id, mount] of trackerMessageMounts) {
      if (id === latestId) continue;
      ctx.dom.uninject(mount);
      trackerMessageMounts.delete(id);
      trackerMessageRenders.delete(id);
    }
    latestTrackerMessageId = latestId;
    updateRegenerateButton();
  };

  const clearLatestMessageRenderIntent = (messageId?: string | null) => {
    if (!latestMessageRenderIntent) return;
    if (messageId && latestMessageRenderIntent.messageId !== messageId) return;
    latestMessageRenderIntent = null;
  };

  const retryLatestMessageRenderIntent = (messageId: string | null) => {
    if (!messageId || !latestMessageRenderIntent || latestMessageRenderIntent.messageId !== messageId) return;
    if (latestMessageRenderIntent.mode === "side_left" || latestMessageRenderIntent.mode === "side_right") return;
    renderTrackerIntoMessage(
      latestMessageRenderIntent.messageId,
      latestMessageRenderIntent.data,
      latestMessageRenderIntent.preset,
      latestMessageRenderIntent.previousData,
      latestMessageRenderIntent.mode,
    );
    pruneNonLatestMessageTrackers();
  };

  const clearSideTrackerRender = () => {
    if (sideTrackerMount) {
      sideTrackerMount.remove();
      sideTrackerMount = null;
    }
    if (sideAppMount) {
      try { sideAppMount.mount.destroy(); } catch { /* already cleaned up */ }
      sideAppMount = null;
    }
  };

  const bindSidePanelTabs = (rootEl: Element | null): void => {
    if (!rootEl) return;
    const wrapper = rootEl.querySelector<HTMLElement>(".sst-side-tracker-root");
    if (!wrapper) return;
    const flagged = wrapper as HTMLElement & { __sstTabsBound?: boolean };
    if (flagged.__sstTabsBound) return;
    flagged.__sstTabsBound = true;
    wrapper.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const tab = target?.closest?.(".sim-tracker-tab") as HTMLElement | null;
      if (!tab || !wrapper.contains(tab)) return;
      const charId = tab.getAttribute("data-character");
      if (charId === null) return;
      const wasActive = tab.classList.contains("active");
      wrapper.querySelectorAll<HTMLElement>(".sim-tracker-tab.active").forEach((el) => el.classList.remove("active"));
      wrapper.querySelectorAll<HTMLElement>(".sim-tracker-card.active").forEach((el) => el.classList.remove("active"));
      if (!wasActive) {
        tab.classList.add("active");
        const escaped = typeof (window as any).CSS?.escape === "function" ? (window as any).CSS.escape(charId) : charId.replace(/"/g, '\\"');
        const card = wrapper.querySelector<HTMLElement>(`.sim-tracker-card[data-character="${escaped}"]`);
        if (card) card.classList.add("active");
      }
    });
  };

  const renderTrackerInSidebar = (
    data: TrackerData,
    preset: TemplatePreset,
    previousData: TrackerData | null,
    mode: TrackerMountMode,
  ) => {
    const markup = buildTrackerMarkup(data, preset, previousData);
    if (!markup.html) return;

    const side = mode === "side_left" ? "left" : "right";

    // Use mountApp if app_manipulation permission is granted
    if (hasPermission("app_manipulation")) {
      // Reuse existing mount on the same side — just update content
      if (sideAppMount && sideAppMount.side === side) {
        const wrapper = sideAppMount.mount.root.querySelector(".sst-side-tracker-root");
        if (wrapper) {
          wrapper.innerHTML = markup.html;
        } else {
          sideAppMount.mount.root.innerHTML = `<div class="sst-side-tracker-root sst-side-${side}">${markup.html}</div>`;
        }
        bindSidePanelTabs(sideAppMount.mount.root);
        return;
      }

      // Switching sides or first mount — tear down old one, create new
      clearSideTrackerRender();

      try {
        const mount = ctx.ui.mountApp({
          className: `sst-app-side-panel sst-app-side-${side}`,
          position: side === "right" ? "end" : "start",
        });

        mount.root.innerHTML = `<div class="sst-side-tracker-root sst-side-${side}">${markup.html}</div>`;
        sideAppMount = { mount, side };
        bindSidePanelTabs(mount.root);
        return;
      } catch {
        // mountApp failed — fall through to legacy
      }
    }

    // Fallback: legacy ctx.ui.mount("sidebar")
    clearSideTrackerRender();
    const sidebarRoot = ctx.ui.mount("sidebar");
    if (!sidebarRoot) return;
    const sideClass = mode === "side_left" ? "sst-side-left" : "sst-side-right";
    const wrapped = `<div class="sst-side-tracker-root ${sideClass}">${markup.html}</div>`;
    sideTrackerMount = ctx.dom.inject(sidebarRoot, wrapped, "beforeend");
    bindSidePanelTabs(sidebarRoot);
  };

  // Pulse Thread (and similar CSS-only tab templates) gate visibility on
  // `:checked` of radio/checkbox inputs. When React reconciles the bubble
  // subtree around our injected host (e.g. on scroll-back through TanStack
  // Virtual's overscan boundary), the browser sometimes drops the live
  // `.checked` property even though the `checked` HTML attribute stays.
  // Result: the host is in the DOM but per-character pages are all hidden
  // until the user clicks a tab (which re-asserts the property). We do the
  // same thing programmatically — but only when the group has no checked
  // member, so user tab clicks stay sticky.
  const restoreFormControlState = (host: Element): void => {
    const checkboxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][checked]'));
    for (const cb of checkboxes) {
      if (!cb.checked) cb.checked = true;
    }
    const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const groups = new Map<string, HTMLInputElement[]>();
    for (const r of radios) {
      const name = r.name || "";
      let list = groups.get(name);
      if (!list) { list = []; groups.set(name, list); }
      list.push(r);
    }
    for (const group of groups.values()) {
      if (group.some((r) => r.checked)) continue;
      const defaultChecked = group.find((r) => r.hasAttribute("checked"));
      if (defaultChecked) defaultChecked.checked = true;
    }
  };

  const showGeneratingIndicator = (messageId: string) => {
    // Tag interceptor flag `removeFromMessage` already strips the existing
    // tracker tag from the bubble before we inject, so the indicator slots
    // into the same vertical space the new tracker will land in.
    pendingGeneratingIndicatorMessageId = messageId;
    const existing = trackerGeneratingIndicators.get(messageId);
    if (existing && existing.isConnected) return;
    const messageNode = ctx.dom.findMessageElement(messageId);
    if (!messageNode) return;
    const bubbleNode =
      (messageNode.querySelector(':scope > div[class*="bubble"]') as Element | null)
      || (messageNode.querySelector('div[class*="bubble"]') as Element | null)
      || (messageNode as Element);
    const host = `<div class="sst-tracker-generating" data-sst-generating-id="${messageId}" role="status" aria-live="polite">Generating tracker…</div>`;
    const mount = ctx.dom.inject(bubbleNode, host, "beforeend");
    trackerGeneratingIndicators.set(messageId, mount);
  };

  const hideGeneratingIndicator = (messageId: string) => {
    if (pendingGeneratingIndicatorMessageId === messageId) {
      pendingGeneratingIndicatorMessageId = null;
    }
    const mount = trackerGeneratingIndicators.get(messageId);
    if (mount) ctx.dom.uninject(mount);
    trackerGeneratingIndicators.delete(messageId);
  };

  const hideAllGeneratingIndicators = () => {
    for (const [, mount] of trackerGeneratingIndicators) ctx.dom.uninject(mount);
    trackerGeneratingIndicators.clear();
    pendingGeneratingIndicatorMessageId = null;
  };

  const retryGeneratingIndicator = (messageId: string | null) => {
    if (!messageId || pendingGeneratingIndicatorMessageId !== messageId) return;
    showGeneratingIndicator(messageId);
  };

  // Cheap deep-equality stable enough for tracker payloads (plain JSON shape).
  // Used to short-circuit re-renders when the parsed data hasn't changed —
  // critical during streaming because the tag interceptor fires per chunk.
  const sameRenderInputs = (
    a: TrackerRenderInputs | undefined,
    data: TrackerData,
    preset: TemplatePreset,
    previousData: TrackerData | null,
    mode: TrackerMountMode,
  ): boolean => {
    if (!a) return false;
    if (a.preset.id !== preset.id || a.mode !== mode) return false;
    if (a.preset.htmlTemplate !== preset.htmlTemplate) return false;
    if (JSON.stringify(a.preset.extSettings) !== JSON.stringify(preset.extSettings)) return false;
    if (JSON.stringify(a.data) !== JSON.stringify(data)) return false;
    if (JSON.stringify(a.previousData) !== JSON.stringify(previousData)) return false;
    return true;
  };

  const renderTrackerIntoMessage = (
    messageId: string,
    data: TrackerData,
    preset: TemplatePreset,
    previousData: TrackerData | null,
    mode: TrackerMountMode,
  ) => {
    const cachedInputs = trackerMessageRenders.get(messageId);
    const existingMount = trackerMessageMounts.get(messageId);
    const stillMounted = !!existingMount && existingMount.isConnected;

    // Hot path: nothing to do. Identical data + same preset/mode + mount
    // still in the DOM ⇒ skip entirely. This is what cuts the per-token
    // re-render flicker during streaming.
    if (stillMounted && sameRenderInputs(cachedInputs, data, preset, previousData, mode)) {
      return;
    }

    // Warm path: mount is still in place, only the payload changed. Swap
    // the innerHTML so there's no detach/attach gap in the paint pipeline.
    if (stillMounted && cachedInputs && cachedInputs.preset.id === preset.id && cachedInputs.mode === mode) {
      const markup = buildTrackerMarkup(data, preset, previousData);
      if (!markup.html) return;
      existingMount!.innerHTML = markup.html;
      trackerMessageRenders.set(messageId, { data, preset, previousData, mode });
      restoreFormControlState(existingMount!);
      return;
    }

    // Cold path: first mount, preset switch, mount lost to virtualization,
    // or mode change — fall through to a clean clear+inject. Also drop any
    // in-progress pill, since the real tracker is about to land here.
    hideGeneratingIndicator(messageId);
    clearMessageTrackerRender(messageId);
    const messageNode = ctx.dom.findMessageElement(messageId);
    if (!messageNode) return;

    const bubbleNode =
      (messageNode.querySelector(':scope > div[class*="bubble"]') as Element | null)
      || (messageNode.querySelector('div[class*="bubble"]') as Element | null)
      || (messageNode as Element);

    const markup = buildTrackerMarkup(data, preset, previousData);
    if (!markup.html) return;
    const host = `<div class="sst-message-tracker-host" data-sst-message-tracker-id="${messageId}">${markup.html}</div>`;
    const insertPos: InsertPosition = mode === "message_top" ? "afterbegin" : "beforeend";
    const mount = ctx.dom.inject(bubbleNode, host, insertPos);
    trackerMessageMounts.set(messageId, mount);
    trackerMessageRenders.set(messageId, { data, preset, previousData, mode });
    restoreFormControlState(mount);
  };

  const handleTrackerPayload = (raw: string, sourceContent: string, messageId: string | null = null) => {
    if (!configReady) {
      if (!pendingTrackerPayload?.authoritative) {
        pendingTrackerPayload = {
          raw,
          sourceContent,
          messageId,
          chatId: currentChatId,
          authoritative: false,
        };
      }
      return;
    }
    let comparisonData = previousTrackerData;
    if (messageId) {
      if (!trackerComparisonBaselines.has(messageId)) {
        trackerComparisonBaselines.clear();
        trackerComparisonBaselines.set(messageId, previousTrackerData);
      }
      comparisonData = trackerComparisonBaselines.get(messageId) || null;
      trackerMessageIds.add(messageId);
      latestTrackerMessageId = messageId;
      updateRegenerateButton();
    }
    const preset = getPresetById(config, config.templateId);
    const mountMode = resolveTrackerMountMode(preset);
    applyThemeClass(preset);
    const parsed = parseTrackerBlock(raw);
    if (!parsed) {
      setStatus("Tracker found (invalid JSON/YAML)");
      renderEmpty(raw);
      if (messageId) {
        clearLatestMessageRenderIntent(messageId);
        clearMessageTrackerRender(messageId);
      }
      return;
    }
    latestTrackerRaw = raw;
    latestTrackerSourceContent = sourceContent;
    setStatus(`Tracker updated (${preset.templateName})`);
    renderTracker(parsed, raw, preset, comparisonData, (html) => {
      injectIntoPanelBody(html);
    });
    // In-message rendering MUST use the messageId for *this* payload. The
    // previous `messageId || latestTrackerMessageId` fallback was unsafe:
    // Lumiverse's tag interceptor declares `messageId` optional, so when it
    // fires for a brand-new message without one, the new payload was
    // mounted into the *previous* message's bubble (the still-cached
    // latestTrackerMessageId). Users saw this as "the new tracker brings
    // me to the last message" — especially with identical character sets,
    // where the stale mount visually matched the new data.
    // Re-applications of an already-mounted tracker (config reload,
    // template switch) must now pass the messageId explicitly.
    if (mountMode === "side_left" || mountMode === "side_right") {
      clearLatestMessageRenderIntent();
      renderTrackerInSidebar(parsed, preset, comparisonData, mountMode);
      if (messageId) clearMessageTrackerRender(messageId);
    } else if (messageId) {
      latestMessageRenderIntent = {
        messageId,
        data: parsed,
        preset,
        previousData: comparisonData,
        mode: mountMode,
      };
      clearSideTrackerRender();
      renderTrackerIntoMessage(messageId, parsed, preset, comparisonData, mountMode);
      pruneNonLatestMessageTrackers();
    }

    previousTrackerData = parsed;
  };

  const handleContent = (content: string, messageId: string | null = null) => {
    latestContent = content;
    const raw = extractTrackerBlock(content, config.codeBlockIdentifier);
    if (!raw) {
      let wasLatest = false;
      if (messageId && trackerMessageIds.has(messageId)) {
        trackerMessageIds.delete(messageId);
        clearLatestMessageRenderIntent(messageId);
        clearMessageTrackerRender(messageId);
        if (latestTrackerMessageId === messageId) {
          latestTrackerMessageId = null;
          wasLatest = true;
          updateRegenerateButton();
        }
      }
      if (wasLatest) {
        previousTrackerData = null;
        trackerComparisonBaselines.clear();
        setStatus("No tracker tag in active swipe/edit");
        renderEmpty("No tracker tag found in this message version.");
      }
      return;
    }
    handleTrackerPayload(raw, content, messageId);
  };

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

  const backendUnsub = ctx.onBackendMessage((payload: unknown) => {
    const obj = payload as Record<string, unknown>;
    if (obj?.type === "tag_interceptor_config") {
      config = {
        ...config,
        trackerTagName: typeof obj.tagName === "string"
          ? sanitizeTagName(obj.tagName)
          : config.trackerTagName,
        codeBlockIdentifier: typeof obj.tagType === "string"
          ? sanitizeIdentifier(obj.tagType)
          : config.codeBlockIdentifier,
        hideSimBlocks: typeof obj.removeFromMessage === "boolean"
          ? obj.removeFromMessage
          : config.hideSimBlocks,
      };
      configTrackerTagNameHint = config.trackerTagName;
      applyHideStyle();
      applyTagInterceptor();
      requestInitialTrackerRehydrate();
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
      connections = obj.connections as ConnectionProfile[];
      populateConnectionDropdown();
      if (connections.length) {
        setLLMStatus(`${connections.length} connection(s) available`);
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
      if (responseChatId) latestTrackerRequestsInFlight.delete(responseChatId);
      if (responseChatId && currentChatId && responseChatId !== currentChatId) return;
      if (!currentChatId && responseChatId) currentChatId = responseChatId;
      if (!responseChatId || awaitingLatestTrackerChatId === responseChatId) {
        awaitingLatestTrackerChatId = null;
      }
      const entry = obj.entry as { messageId?: unknown; payload?: unknown; previousPayload?: unknown } | null;
      if (entry && typeof entry.payload === "string" && entry.payload.trim()) {
        const msgId = typeof entry.messageId === "string" ? entry.messageId : null;
        // Hydration safety net: only useful when the latest tracker-bearing
        // message wasn't reprocessed through a live frontend event yet. If
        // we already handled that messageId, skip — otherwise we'd flash the
        // message-level render with `previousData` now equal to the latest
        // data (no diffs).
        if (msgId && trackerMessageIds.has(msgId)) {
          pendingTrackerPayload = null;
          return;
        }
        if (msgId) {
          const previous = typeof entry.previousPayload === "string"
            ? parseTrackerBlock(entry.previousPayload)
            : null;
          trackerComparisonBaselines.clear();
          trackerComparisonBaselines.set(msgId, previous);
        }
        pendingTrackerPayload = {
          raw: entry.payload,
          sourceContent: entry.payload,
          messageId: msgId,
          chatId: responseChatId,
          authoritative: true,
        };
      }
      flushPendingTrackerPayload();
      return;
    }
    if (obj?.type === "permission_changed") {
      const allGranted = Array.isArray(obj.allGranted)
        ? obj.allGranted.filter((p): p is string => typeof p === "string")
        : grantedPermissions;
      grantedPermissions = allGranted;
      renderCapabilities(grantedPermissions, requestedPermissions, ephemeralPoolStatus);
      updatePermissionGatedControls();
      return;
    }
    if (obj?.type !== "config" || !obj.config || typeof obj.config !== "object") return;
    const incoming = obj.config as Record<string, unknown>;
    grantedPermissions = Array.isArray(obj.grantedPermissions)
      ? obj.grantedPermissions.filter((p): p is string => typeof p === "string")
      : grantedPermissions;
    requestedPermissions = Array.isArray(obj.requestedPermissions)
      ? obj.requestedPermissions.filter((p): p is string => typeof p === "string")
      : requestedPermissions;
    runtimeSeededPresets = Array.isArray(obj.seededPresets)
      ? (obj.seededPresets as TemplatePreset[])
      : runtimeSeededPresets;
    ephemeralPoolStatus = obj.ephemeralPoolStatus && typeof obj.ephemeralPoolStatus === "object"
      ? (obj.ephemeralPoolStatus as Record<string, unknown>)
      : null;
    config = {
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
    configReady = true;
    if (configRetryTimer) {
      clearTimeout(configRetryTimer);
      configRetryTimer = null;
    }
    syncControls();
    configTrackerTagNameHint = config.trackerTagName;
    applyHideStyle();
    applyTagInterceptor();
    applyThemeClass(getPresetById(config, config.templateId));
    renderCapabilities(grantedPermissions, requestedPermissions, ephemeralPoolStatus);
    updatePermissionGatedControls();
    if (latestContent) {
      handleContent(latestContent, latestTrackerMessageId);
    } else if (latestTrackerRaw) {
      handleTrackerPayload(latestTrackerRaw, latestTrackerSourceContent || latestTrackerRaw, latestTrackerMessageId);
    }
    if (shouldResetStatusAfterConfigLoad()) {
      setStatus(DEFAULT_PANEL_STATUS);
    }
    requestInitialTrackerRehydrate();
    flushPendingTrackerPayload();
    inlineProcessor.processAll();
  });

  const runInlinePass = (messageId: string | null) => {
    if (messageId) inlineProcessor.processMessage(messageId);
    else inlineProcessor.processAll();
  };

  const extractChatId = (payload: unknown): string | null => {
    if (!payload || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    const direct = typeof obj.chatId === "string" ? obj.chatId : typeof obj.chat_id === "string" ? obj.chat_id : null;
    if (direct) return direct;
    const nested = obj.message as Record<string, unknown> | undefined;
    return typeof nested?.chatId === "string" ? nested.chatId : typeof nested?.chat_id === "string" ? nested.chat_id : null;
  };

  const handleChatSwitch = (chatId: string | null) => {
    if (!chatId || chatId === currentChatId) return;
    currentChatId = chatId;
    awaitingLatestTrackerChatId = chatId;
    pendingTrackerPayload = null;
    updateRegenerateButton();
    resetChatState();
    renderEmpty("When a message includes a tracker tag, cards will appear here.");
    requestLatestTracker(chatId);
    // Wait two frames for Lumiverse to finish painting the new chat's
    // messages before running the inline-template sweep.
    if (configReady) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        inlineProcessor.processAll();
      }));
    }
  };

  const isActivityForActiveChat = (activityChatId: string | null): boolean => {
    let hostActiveChatId: string | null = null;
    try {
      const active = ctx.getActiveChat();
      hostActiveChatId = active?.chatId || null;
    } catch {
      // Fall back to the last explicit CHAT_SWITCHED event on older hosts.
    }

    // Synchronize to the host's actual selection, never to the chat named by
    // an arbitrary generation/message event (which may be a queued chat).
    if (hostActiveChatId && hostActiveChatId !== currentChatId) {
      handleChatSwitch(hostActiveChatId);
    }

    const activeChatId = hostActiveChatId || currentChatId;
    if (!activeChatId) {
      // Startup fallback for hosts where getActiveChat() is unavailable and
      // CHAT_SWITCHED has not fired yet.
      if (activityChatId) handleChatSwitch(activityChatId);
      return true;
    }
    return !activityChatId || activityChatId === activeChatId;
  };

  const onEvent = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context) return;
    if (context.isUser === true) return;
    if (context.content) handleContent(context.content, context.messageId);
    runInlinePass(context.messageId);
  };

  const onSwipe = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context) return;
    if (context.isUser === true) return;

    // Proactively clear all tracker renders on every swipe.
    // Historical swipes (content has tracker data) will re-render immediately below.
    // New-generation swipes (empty content) stay cleared until GENERATION_ENDED.
    clearSideTrackerRender();
    if (latestTrackerMessageId) {
      clearMessageTrackerRender(latestTrackerMessageId);
      inlineProcessor.clearMessage(latestTrackerMessageId);
    }
    if (context.messageId) inlineProcessor.clearMessage(context.messageId);
    previousTrackerData = null;
    trackerComparisonBaselines.clear();
    latestTrackerRaw = null;
    latestTrackerSourceContent = null;
    latestContent = null;
    latestMessageRenderIntent = null;

    // If the swiped-to message already has content (historical), process it now.
    if (context.content) {
      handleContent(context.content, context.messageId);
    }
    runInlinePass(context.messageId);
  };

  const onMessageRendered = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context || context.isUser === true) return;
    retryLatestMessageRenderIntent(context.messageId);
    retryGeneratingIndicator(context.messageId);
    const latestMountedId = ctx.messages.getLatestMessageId();
    const needsLatestAttach =
      !!context.messageId &&
      context.messageId === latestMountedId &&
      latestMessageRenderIntent?.messageId !== context.messageId &&
      !trackerMessageRenders.has(context.messageId);
    if (needsLatestAttach && context.content) {
      handleContent(context.content, context.messageId);
    }
    runInlinePass(context.messageId);
  };

  const onMessageDeleted = (payload: unknown) => {
    if (!isActivityForActiveChat(extractChatId(payload))) return;
    const context = readMessageContext(payload);
    if (!context || !context.messageId) return;
    // Tear down any local tracker render and forget the message so the
    // regenerate button and the side panel don't reference a ghost.
    if (trackerMessageIds.has(context.messageId)) {
      trackerMessageIds.delete(context.messageId);
      clearLatestMessageRenderIntent(context.messageId);
      clearMessageTrackerRender(context.messageId);
    }
    trackerComparisonBaselines.delete(context.messageId);
    hideGeneratingIndicator(context.messageId);
    inlineProcessor.clearMessage(context.messageId);
    if (latestTrackerMessageId === context.messageId) {
      latestTrackerMessageId = null;
      previousTrackerData = null;
      trackerComparisonBaselines.clear();
      latestTrackerRaw = null;
      latestTrackerSourceContent = null;
      latestContent = null;
      clearSideTrackerRender();
      updateRegenerateButton();
    }
    // The backend has its own MESSAGE_DELETED subscription that drops the
    // side-channel entry, so no frontend → backend bridge needed here.
  };

  // Virtualization replay is handled host-side: the wrapper returned by
  // ctx.dom.inject() is preserved across scroll-away/scroll-back and moved
  // back into the remounted bubble with its identity, form state, and
  // listeners intact. We keep the latest render intent around so
  // CHARACTER_MESSAGE_RENDERED can finish the first attach as soon as the
  // newest bubble mounts, then trust the host to keep it attached.

  const resetChatState = () => {
    previousTrackerData = null;
    trackerComparisonBaselines.clear();
    latestTrackerMessageId = null;
    latestTrackerRaw = null;
    latestTrackerSourceContent = null;
    latestContent = null;
    latestMessageRenderIntent = null;
    trackerMessageIds.clear();
    updateRegenerateButton();
    for (const mount of trackerMessageMounts.values()) ctx.dom.uninject(mount);
    trackerMessageMounts.clear();
    trackerMessageRenders.clear();
    hideAllGeneratingIndicators();
    clearSideTrackerRender();
    inlineProcessor.destroy();
  };

  const generationUnsub = ctx.events.on("GENERATION_ENDED", onEvent);
  const messageUnsub = ctx.events.on("MESSAGE_SENT", onEvent);
  const messageEditedUnsub = ctx.events.on("MESSAGE_EDITED", onEvent);
  const messageSwipedUnsub = ctx.events.on("MESSAGE_SWIPED", onSwipe);
  // SWIPE_EDITED is coarser than MESSAGE_SWIPED and fires when another
  // extension rewrites the swipe array via chat.updateMessage(). The
  // payload carries the full post-mutation message, so we can reuse
  // the swipe pipeline to re-process whatever the new content is.
  const swipeEditedUnsub = ctx.events.on("SWIPE_EDITED", onSwipe);
  const messageDeletedUnsub = ctx.events.on("MESSAGE_DELETED", onMessageDeleted);
  const messageRenderedUnsub = ctx.events.on("CHARACTER_MESSAGE_RENDERED", onMessageRendered);
  // Spindle emits CHAT_SWITCHED with `{ chatId: string | null }` on
  // navigation. Subscribing directly means the panel notices a chat change
  // even when no message activity follows it (e.g. opening an empty chat
  // or jumping between two chats without sending anything).
  const chatSwitchedUnsub = ctx.events.on("CHAT_SWITCHED", (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const obj = payload as Record<string, unknown>;
    const chatId = typeof obj.chatId === "string" ? obj.chatId : null;
    handleChatSwitch(chatId);
  });

  const stopInlineObserver = inlineProcessor.observeDocument();

  const permissionUnsub = ctx.events.on("PERMISSION_CHANGED", (detail: unknown) => {
    if (!detail || typeof detail !== "object") return;
    const ev = detail as Record<string, unknown>;
    const allGranted = Array.isArray(ev.allGranted)
      ? ev.allGranted.filter((p): p is string => typeof p === "string")
      : null;
    if (allGranted) {
      grantedPermissions = allGranted;
      renderCapabilities(grantedPermissions, requestedPermissions, ephemeralPoolStatus);
      updatePermissionGatedControls();
    }
  });

  const saveButton = byId<HTMLElement>("sst-lumi-save");
  const templateSelect = byId<HTMLSelectElement>("sst-lumi-template");
  templateSelect?.addEventListener("change", () => {
    config = { ...config, templateId: templateSelect.value || DEFAULT_CONFIG.templateId };
    const preset = getPresetById(config, config.templateId);
    applyThemeClass(preset);
    const identifierInput = byId<HTMLInputElement>("sst-lumi-identifier");
    if (identifierInput && preset.extSettings?.codeBlockIdentifier) {
      identifierInput.value = String(preset.extSettings.codeBlockIdentifier);
    }
    if (latestContent) {
      handleContent(latestContent, latestTrackerMessageId);
    } else if (latestTrackerRaw) {
      handleTrackerPayload(latestTrackerRaw, latestTrackerSourceContent || latestTrackerRaw, latestTrackerMessageId);
    }
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
    const preset = getPresetById(config, selectedTemplate);
    const fallbackId = preset.extSettings?.codeBlockIdentifier;

    const llmEnable = byId<HTMLInputElement>("sst-lumi-llm-enable");
    const llmConnection = byId<HTMLSelectElement>("sst-lumi-llm-connection");
    const llmMsgCount = byId<HTMLInputElement>("sst-lumi-llm-msgcount");
    const llmTemp = byId<HTMLInputElement>("sst-lumi-llm-temp");
    const llmStrip = byId<HTMLInputElement>("sst-lumi-llm-strip");
    const tsEnable = byId<HTMLInputElement>("sst-lumi-ts-enable");
    const tsKey = byId<HTMLInputElement>("sst-lumi-ts-key");
    const tsModel = byId<HTMLInputElement>("sst-lumi-ts-model");
    const tsQuick = byId<HTMLInputElement>("sst-lumi-ts-quick");
    const tsVerify = byId<HTMLInputElement>("sst-lumi-ts-verify");
    const tsConception = byId<HTMLInputElement>("sst-lumi-ts-conception");
    const tsConfidence = byId<HTMLInputElement>("sst-lumi-ts-confidence");

    config = buildSavedFrontendConfig(config, {
      selectedTemplate,
      tag: tagInput?.value,
      identifier: identifierInput?.value,
      hide: hideInput?.checked,
      inline: inlineInput?.checked,
      format: formatSelect?.value,
      retain: retainInput?.value,
      llmEnable: llmEnable?.checked,
      llmConnection: llmConnection?.value,
      llmModel: modelCombobox?.getValue(),
      llmMsgCount: llmMsgCount?.value,
      llmTemp: llmTemp?.value,
      llmStrip: llmStrip?.checked,
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
    configTrackerTagNameHint = config.trackerTagName;
    applyTagInterceptor();
    inlineProcessor.processAll();
    setStatus("Saving settings...");
  });

  const exportButton = byId<HTMLElement>("sst-lumi-export");
  exportButton?.addEventListener("click", () => {
    const preset = getPresetById(config, config.templateId);
    downloadJson(`${preset.templateName.replace(/\s+/g, "_").toLowerCase()}_preset.json`, preset);
    setStatus("Preset exported");
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
      });
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
    config = { ...config, secondaryLLMConnectionId: llmConnectionSelect.value, secondaryLLMModel: "" };
    ensureModelCombobox()?.update({
      connection: buildConnectionRef(llmConnectionSelect.value),
      value: "",
    });
  });

  const llmRegenerateBtn = byId<HTMLButtonElement>("sst-lumi-llm-regenerate");
  llmRegenerateBtn?.addEventListener("click", () => {
    if (!currentChatId) {
      setLLMStatus("Open a chat first to regenerate", "error");
      return;
    }
    setLLMStatus("Regenerating tracker...", "generating");
    ctx.sendToBackend({
      type: "regenerate_secondary_tracker",
      chatId: currentChatId,
      // Hint the message we last rendered a tracker for, if any. Backend
      // falls back to the latest assistant message when this is absent
      // or stale, so a missing hint is fine.
      messageId: latestTrackerMessageId ?? undefined,
    });
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
    panelRoot = null;
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
