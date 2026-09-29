import type { SpindleAppMountHandle, SpindleFrontendContext } from "lumiverse-spindle-types";
import type { TemplatePreset } from "../shared/templatePresets";
import type { TrackerConfig } from "../shared/trackerConfig";
import { parseTrackerBlock, type TrackerData } from "../shared/trackerData";
import { resolveTrackerMountMode, type TrackerMountMode } from "./frontendTemplate";
import { buildTrackerMarkup } from "./frontendTemplateRenderer";
import type { TrackerHydration } from "./trackerHydration";

export type TrackerRenderInputs = {
  data: TrackerData;
  preset: TemplatePreset;
  previousData: TrackerData | null;
  mode: TrackerMountMode;
};
export type LatestMessageRenderIntent = TrackerRenderInputs & { messageId: string };
export type PendingTrackerPayload = {
  raw: string;
  sourceContent: string;
  messageId: string | null;
  chatId: string | null;
  authoritative: boolean;
};

export function createTrackerRendering(deps: {
  ctx: SpindleFrontendContext;
  byId: <T extends Element>(id: string) => T | null;
  state: {
    previousTrackerData: TrackerData | null;
    latestContent: string | null;
    latestTrackerMessageId: string | null;
    latestTrackerRaw: string | null;
    latestTrackerSourceContent: string | null;
    trackerMessageIds: Set<string>;
    trackerMessageMounts: Map<string, Element>;
    trackerMessageRenders: Map<string, TrackerRenderInputs>;
    trackerComparisonBaselines: Map<string, TrackerData | null>;
    trackerGeneratingIndicators: Map<string, Element>;
    latestMessageRenderIntent: LatestMessageRenderIntent | null;
    pendingGeneratingIndicatorMessageId: string | null;
    sideTrackerMount: Element | null;
    sideAppMount: { mount: SpindleAppMountHandle; side: string } | null;
  };
  hydration: TrackerHydration;
  readConfig: () => TrackerConfig;
  isConfigReady: () => boolean;
  getPresetById: (config: TrackerConfig, id: string) => TemplatePreset;
  extractTrackerBlock: (content: string, identifier: string) => string | null;
  setStatus: (text: string) => void;
  renderEmpty: (message: string) => void;
  renderTracker: (data: TrackerData, raw: string, preset: TemplatePreset, previousData: TrackerData | null, injectSanitized: (html: string) => void) => void;
  applyThemeClass: (preset: TemplatePreset) => void;
  updateRegenerateButton: () => void;
  hasPermission: (name: string) => boolean;
}) {
  const {
    ctx, byId, state, getPresetById, extractTrackerBlock, setStatus,
    renderEmpty, renderTracker, applyThemeClass, updateRegenerateButton, hasPermission,
  } = deps;
  const injectIntoPanelBody = (html: string) => {
    const panelBody = byId<HTMLElement>("sst-lumi-body");
    if (!panelBody || !panelBody.isConnected) return;
    ctx.dom.inject(panelBody, html, "beforeend");
  };

  const clearMessageTrackerRender = (messageId: string) => {
    const mount = state.trackerMessageMounts.get(messageId);
    if (mount) {
      ctx.dom.uninject(mount);
      state.trackerMessageMounts.delete(messageId);
    }
    state.trackerMessageRenders.delete(messageId);
  };

  // Source of truth is the host's chat-data store via getLatestMessageId(),
  // not DOM order — DOM only reflects the virtualizer's current window, so
  // the visually-last bubble can be a mid-chat message scrolled to bottom.
  const pruneNonLatestMessageTrackers = () => {
    const latestId = ctx.messages.getLatestMessageId();
    if (!latestId) return;
    for (const [id, mount] of state.trackerMessageMounts) {
      if (id === latestId) continue;
      ctx.dom.uninject(mount);
      state.trackerMessageMounts.delete(id);
      state.trackerMessageRenders.delete(id);
    }
    state.latestTrackerMessageId = latestId;
    updateRegenerateButton();
  };

  const clearLatestMessageRenderIntent = (messageId?: string | null) => {
    if (!state.latestMessageRenderIntent) return;
    if (messageId && state.latestMessageRenderIntent.messageId !== messageId) return;
    state.latestMessageRenderIntent = null;
  };

  const retryLatestMessageRenderIntent = (messageId: string | null) => {
    if (!messageId || !state.latestMessageRenderIntent || state.latestMessageRenderIntent.messageId !== messageId) return;
    if (state.latestMessageRenderIntent.mode === "side_left" || state.latestMessageRenderIntent.mode === "side_right") return;
    renderTrackerIntoMessage(
      state.latestMessageRenderIntent.messageId,
      state.latestMessageRenderIntent.data,
      state.latestMessageRenderIntent.preset,
      state.latestMessageRenderIntent.previousData,
      state.latestMessageRenderIntent.mode,
    );
    pruneNonLatestMessageTrackers();
  };

  const clearSideTrackerRender = () => {
    if (state.sideTrackerMount) {
      state.sideTrackerMount.remove();
      state.sideTrackerMount = null;
    }
    if (state.sideAppMount) {
      try { state.sideAppMount.mount.destroy(); } catch { /* already cleaned up */ }
      state.sideAppMount = null;
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
        const escaped = typeof window.CSS?.escape === "function" ? window.CSS.escape(charId) : charId.replace(/"/g, '\\"');
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
      if (state.sideAppMount && state.sideAppMount.side === side) {
        const wrapper = state.sideAppMount.mount.root.querySelector(".sst-side-tracker-root");
        if (wrapper) {
          wrapper.innerHTML = markup.html;
        } else {
          state.sideAppMount.mount.root.innerHTML = `<div class="sst-side-tracker-root sst-side-${side}">${markup.html}</div>`;
        }
        bindSidePanelTabs(state.sideAppMount.mount.root);
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
        state.sideAppMount = { mount, side };
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
    state.sideTrackerMount = ctx.dom.inject(sidebarRoot, wrapped, "beforeend");
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
    state.pendingGeneratingIndicatorMessageId = messageId;
    const existing = state.trackerGeneratingIndicators.get(messageId);
    if (existing && existing.isConnected) return;
    const messageNode = ctx.dom.findMessageElement(messageId);
    if (!messageNode) return;
    const bubbleNode =
      (messageNode.querySelector(':scope > div[class*="bubble"]') as Element | null)
      || (messageNode.querySelector('div[class*="bubble"]') as Element | null)
      || (messageNode as Element);
    const host = `<div class="sst-tracker-generating" data-sst-generating-id="${messageId}" role="status" aria-live="polite">Generating tracker…</div>`;
    const mount = ctx.dom.inject(bubbleNode, host, "beforeend");
    state.trackerGeneratingIndicators.set(messageId, mount);
  };

  const hideGeneratingIndicator = (messageId: string) => {
    if (state.pendingGeneratingIndicatorMessageId === messageId) {
      state.pendingGeneratingIndicatorMessageId = null;
    }
    const mount = state.trackerGeneratingIndicators.get(messageId);
    if (mount) ctx.dom.uninject(mount);
    state.trackerGeneratingIndicators.delete(messageId);
  };

  const hideAllGeneratingIndicators = () => {
    for (const [, mount] of state.trackerGeneratingIndicators) ctx.dom.uninject(mount);
    state.trackerGeneratingIndicators.clear();
    state.pendingGeneratingIndicatorMessageId = null;
  };

  const retryGeneratingIndicator = (messageId: string | null) => {
    if (!messageId || state.pendingGeneratingIndicatorMessageId !== messageId) return;
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
    const cachedInputs = state.trackerMessageRenders.get(messageId);
    const existingMount = state.trackerMessageMounts.get(messageId);
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
      state.trackerMessageRenders.set(messageId, { data, preset, previousData, mode });
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
    state.trackerMessageMounts.set(messageId, mount);
    state.trackerMessageRenders.set(messageId, { data, preset, previousData, mode });
    restoreFormControlState(mount);
  };

  const handleTrackerPayload = (raw: string, sourceContent: string, messageId: string | null = null) => {
    if (!deps.isConfigReady()) {
      deps.hydration.offerPending({
          raw,
          sourceContent,
          messageId,
          chatId: deps.hydration.currentChatId(),
          authoritative: false,
      });
      return;
    }
    let comparisonData = state.previousTrackerData;
    if (messageId) {
      if (!state.trackerComparisonBaselines.has(messageId)) {
        state.trackerComparisonBaselines.clear();
        state.trackerComparisonBaselines.set(messageId, state.previousTrackerData);
      }
      comparisonData = state.trackerComparisonBaselines.get(messageId) || null;
      state.trackerMessageIds.add(messageId);
      state.latestTrackerMessageId = messageId;
      updateRegenerateButton();
    }
    const preset = getPresetById(deps.readConfig(), deps.readConfig().templateId);
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
    state.latestTrackerRaw = raw;
    state.latestTrackerSourceContent = sourceContent;
    setStatus(`Tracker updated (${preset.templateName})`);
    renderTracker(parsed, raw, preset, comparisonData, (html) => {
      injectIntoPanelBody(html);
    });
    // In-message rendering MUST use the messageId for *this* payload. The
    // previous `messageId || state.latestTrackerMessageId` fallback was unsafe:
    // Lumiverse's tag interceptor declares `messageId` optional, so when it
    // fires for a brand-new message without one, the new payload was
    // mounted into the *previous* message's bubble (the still-cached
    // state.latestTrackerMessageId). Users saw this as "the new tracker brings
    // me to the last message" — especially with identical character sets,
    // where the stale mount visually matched the new data.
    // Re-applications of an already-mounted tracker (config reload,
    // template switch) must now pass the messageId explicitly.
    if (mountMode === "side_left" || mountMode === "side_right") {
      clearLatestMessageRenderIntent();
      renderTrackerInSidebar(parsed, preset, comparisonData, mountMode);
      if (messageId) clearMessageTrackerRender(messageId);
    } else if (messageId) {
      state.latestMessageRenderIntent = {
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

    state.previousTrackerData = parsed;
  };

  const handleContent = (content: string, messageId: string | null = null) => {
    state.latestContent = content;
    const raw = extractTrackerBlock(content, deps.readConfig().codeBlockIdentifier);
    if (!raw) {
      let wasLatest = false;
      if (messageId && state.trackerMessageIds.has(messageId)) {
        state.trackerMessageIds.delete(messageId);
        clearLatestMessageRenderIntent(messageId);
        clearMessageTrackerRender(messageId);
        if (state.latestTrackerMessageId === messageId) {
          state.latestTrackerMessageId = null;
          wasLatest = true;
          updateRegenerateButton();
        }
      }
      if (wasLatest) {
        state.previousTrackerData = null;
        state.trackerComparisonBaselines.clear();
        setStatus("No tracker tag in active swipe/edit");
        renderEmpty("No tracker tag found in this message version.");
      }
      return;
    }
    handleTrackerPayload(raw, content, messageId);
  };

  return {
    clearMessageTrackerRender,
    pruneNonLatestMessageTrackers,
    clearLatestMessageRenderIntent,
    retryLatestMessageRenderIntent,
    clearSideTrackerRender,
    showGeneratingIndicator,
    hideGeneratingIndicator,
    hideAllGeneratingIndicators,
    retryGeneratingIndicator,
    handleTrackerPayload,
    handleContent,
  };
}
