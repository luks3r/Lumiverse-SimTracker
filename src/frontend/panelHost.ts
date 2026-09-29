import { getTemplatePresets, mergeTemplatePresets, type TemplatePreset } from "../shared/templatePresets";
import type { TrackerConfig } from "../shared/trackerConfig";
import type { TrackerData } from "../shared/trackerData";
import { buildTrackerMarkup } from "./frontendTemplateRenderer";
import { CONFIG_ERROR_STATUS_PREFIX, LOADING_CONFIG_STATUS } from "./frontendPanel";

export function createPanelHost() {
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

function isImportedTemplate(config: TrackerConfig, id: string): boolean {
  return config.userPresets.some((preset) => preset.id === id)
    && !BUILTIN_PRESETS.some((preset) => preset.id === id)
    && !runtimeSeededPresets.some((preset) => preset.id === id);
}

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

  return {
    byId,
    getAllPresets,
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
    setPanelRoot: (value: Element | null) => { panelRoot = value; },
    setSeededPresets: (value: TemplatePreset[]) => { runtimeSeededPresets = value; },
  };
}
