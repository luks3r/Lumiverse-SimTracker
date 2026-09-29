export const DEFAULT_PANEL_STATUS = "Waiting for tracker tag...";
export const LOADING_CONFIG_STATUS = "Loading config...";
export const CONFIG_ERROR_STATUS_PREFIX = "Config load failed:";

export const PANEL_HTML = `
  <section id="sst-lumi-panel" class="sst-lumi-panel">
    <header class="sst-lumi-header">
      <h3>Silly Sim Tracker</h3>
      <span class="sst-lumi-status" id="sst-lumi-status">${DEFAULT_PANEL_STATUS}</span>
    </header>
    <div class="sst-lumi-controls">
      <label>Template<select id="sst-lumi-template"></select></label>
      <label>Tracker tag<input id="sst-lumi-tag" type="text" value="tracker" maxlength="30" /></label>
      <label>Identifier<input id="sst-lumi-identifier" type="text" value="sim" maxlength="30" /></label>
      <label>Preferred format<select id="sst-lumi-format"><option value="json">JSON</option><option value="yaml">YAML</option></select></label>
      <label>Retain tracker tags in prompt<input id="sst-lumi-retain" type="number" min="0" max="20" value="3" /></label>
      <label class="sst-lumi-checkbox"><input id="sst-lumi-inline" type="checkbox" />Enable inline displays</label>
      <label class="sst-lumi-checkbox"><input id="sst-lumi-hide" type="checkbox" checked />Hide tracker tags in chat</label>
      <label>New-chat fertility cycle start
        <select id="sst-lumi-cycle-bias">
          <option value="random">Random</option>
          <option value="menstruating">Menstruating</option>
          <option value="start_follicular">Start of Follicular</option>
          <option value="close_ovulation">Close to Ovulation</option>
          <option value="ovulating">Ovulating</option>
          <option value="start_luteal">Start of Luteal</option>
          <option value="end_luteal">End of Luteal</option>
        </select>
      </label>
      <div class="sst-lumi-actions">
        <button id="sst-lumi-save" type="button">Save Settings</button>
        <button id="sst-lumi-export" type="button">Export Preset</button>
        <button id="sst-lumi-import" type="button">Import Preset</button>
        <button id="sst-lumi-delete-template" type="button" disabled>Delete Template</button>
      </div>
      <div id="sst-lumi-capabilities" class="sst-lumi-capabilities">Capabilities: loading...</div>
    </div>
    <details id="sst-lumi-packs-section" class="sst-lumi-packs-section">
      <summary class="sst-lumi-packs-summary">Inline Display Packs <span id="sst-lumi-packs-count" class="sst-lumi-packs-count">(0)</span></summary>
      <div class="sst-lumi-packs-controls">
        <div id="sst-lumi-packs-list" class="sst-lumi-packs-list"></div>
        <button id="sst-lumi-import-pack" type="button" class="sst-lumi-pack-import">Import Inline Pack</button>
        <div class="sst-lumi-pack-hint">Packs apply globally whenever "Enable inline displays" is on, independent of the selected template.</div>
      </div>
    </details>
    <details id="sst-lumi-llm-section" class="sst-lumi-llm-section">
      <summary class="sst-lumi-llm-summary">Secondary LLM Generation</summary>
      <div class="sst-lumi-llm-controls">
        <label class="sst-lumi-checkbox"><input id="sst-lumi-llm-enable" type="checkbox" />Enable secondary LLM generation</label>
        <label>Connection Profile
          <select id="sst-lumi-llm-connection"><option value="">Loading connections...</option></select>
        </label>
        <label>Model
          <div id="sst-lumi-llm-model-mount" class="sst-lumi-llm-model-mount"></div>
        </label>
        <label>Context Messages<input id="sst-lumi-llm-msgcount" type="number" min="1" max="50" value="5" /></label>
        <label>Temperature<input id="sst-lumi-llm-temp" type="number" min="0" max="2" step="0.1" value="0.7" /></label>
        <label class="sst-lumi-checkbox"><input id="sst-lumi-llm-json-format" type="checkbox" />Request JSON output format (JSON trackers only; provider must support it)</label>
        <label class="sst-lumi-checkbox"><input id="sst-lumi-llm-strip" type="checkbox" checked />Strip structural HTML from context</label>
        <button id="sst-lumi-llm-regenerate" type="button" class="sst-lumi-llm-regenerate" disabled>Regenerate Last Tracker</button>
        <div id="sst-lumi-llm-status" class="sst-lumi-llm-status"></div>
      </div>
    </details>
    <details id="sst-lumi-typesafe-section" class="sst-lumi-llm-section">
      <summary class="sst-lumi-llm-summary">TypeSafe AI Quick Appends (Jev)</summary>
      <div class="sst-lumi-llm-controls">
        <label class="sst-lumi-checkbox"><input id="sst-lumi-ts-enable" type="checkbox" />Enable TypeSafe gate &amp; quick appends</label>
        <label>API Key
          <input id="sst-lumi-ts-key" type="password" autocomplete="off" spellcheck="false" placeholder="Key from console.typesafe.ai" />
        </label>
        <label>Model<input id="sst-lumi-ts-model" type="text" placeholder="jev-latest" /></label>
        <label class="sst-lumi-checkbox"><input id="sst-lumi-ts-quick" type="checkbox" checked />Quick-append fast lane (minor changes skip the full LLM)</label>
        <label class="sst-lumi-checkbox"><input id="sst-lumi-ts-verify" type="checkbox" checked />Verify full-LLM appends before applying</label>
        <label class="sst-lumi-checkbox"><input id="sst-lumi-ts-conception" type="checkbox" checked />Jev decides gray-zone conceptions (replaces the coin flip)</label>
        <label>Confidence Floor<input id="sst-lumi-ts-confidence" type="number" min="0.3" max="0.95" step="0.05" value="0.6" /></label>
        <div class="sst-lumi-pack-hint">Requires "Enable secondary LLM generation" plus the cors_proxy permission. One Jev call gates each turn: no change → no append, minor change → numeric patch without an LLM call, anything else (or low confidence) → the full secondary LLM.</div>
      </div>
    </details>
    <div id="sst-lumi-body" class="sst-lumi-body"></div>
    <div id="sst-lumi-command" class="sst-lumi-command" style="display:none"></div>
  </section>
`;

export const PANEL_CSS = `
  .sst-lumi-panel { width: 100%; max-height: min(80vh, 900px); overflow: auto; border: 1px solid var(--lumiverse-border); border-radius: calc(var(--lumiverse-radius) + 2px); background: linear-gradient(180deg, var(--lumiverse-fill) 0%, var(--lumiverse-fill-subtle) 100%); color: var(--lumiverse-text); box-shadow: 0 14px 50px rgba(0, 0, 0, 0.28); }
  .sst-lumi-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--lumiverse-border); }
  .sst-lumi-header h3 { margin: 0; font-size: 13px; }
  .sst-lumi-status { color: var(--lumiverse-text-muted); font-size: 11px; }
  .sst-lumi-controls { padding: 10px 12px; border-bottom: 1px solid var(--lumiverse-border); display: grid; gap: 8px; }
  .sst-lumi-controls label { font-size: 11px; color: var(--lumiverse-text-muted); display: grid; gap: 5px; }
  .sst-lumi-controls input[type="text"], .sst-lumi-controls input[type="number"], .sst-lumi-controls select { font-size: 12px; padding: 6px 8px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); }
  .sst-lumi-checkbox { align-items: center; display: flex !important; gap: 8px; }
  .sst-lumi-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .sst-lumi-actions button { font-size: 12px; padding: 5px 10px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); cursor: pointer; }
  .sst-lumi-capabilities { font-size: 11px; color: var(--lumiverse-text-muted); border: 1px dashed var(--lumiverse-border); border-radius: 8px; padding: 7px 8px; }
  .sst-lumi-body { padding: 12px; display: grid; gap: 8px; }
  .sst-lumi-raw { font-size: 11px; border: 1px dashed var(--lumiverse-border); border-radius: 8px; padding: 8px; color: var(--lumiverse-text-muted); white-space: pre-wrap; word-break: break-word; }
  .sst-inline-section { border: 1px solid var(--lumiverse-border); border-radius: 10px; padding: 10px; background: var(--lumiverse-fill-subtle); }
  .sst-inline-title { font-size: 11px; color: var(--lumiverse-text-muted); margin-bottom: 8px; }
  .sst-inline-item { margin-bottom: 8px; }
  .sst-lumi-command { margin: 10px 12px 12px; padding: 10px; border: 1px solid var(--lumiverse-border); border-radius: 10px; background: var(--lumiverse-fill-subtle); display: grid; gap: 8px; }
  .sst-lumi-command textarea { width: 100%; min-height: 96px; resize: vertical; font-size: 11px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill); color: var(--lumiverse-text); padding: 8px; }
  .sst-lumi-command button { width: fit-content; font-size: 11px; padding: 5px 10px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); cursor: pointer; }
  .sst-lumi-packs-section { border-bottom: 1px solid var(--lumiverse-border); }
  .sst-lumi-packs-summary { padding: 10px 12px; font-size: 12px; cursor: pointer; color: var(--lumiverse-text); user-select: none; }
  .sst-lumi-packs-summary:hover { background: var(--lumiverse-fill-subtle); }
  .sst-lumi-packs-count { color: var(--lumiverse-text-muted); font-size: 11px; margin-left: 4px; }
  .sst-lumi-packs-controls { padding: 0 12px 10px; display: grid; gap: 8px; }
  .sst-lumi-packs-list { display: grid; gap: 6px; }
  .sst-lumi-packs-list:empty::before { content: "No packs imported. Click below to import one."; font-size: 11px; color: var(--lumiverse-text-muted); font-style: italic; }
  .sst-lumi-pack-row { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill-subtle); }
  .sst-lumi-pack-row.sst-pack-disabled { opacity: 0.55; }
  .sst-lumi-pack-info { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; }
  .sst-lumi-pack-name { font-size: 12px; color: var(--lumiverse-text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sst-lumi-pack-meta { font-size: 10px; color: var(--lumiverse-text-muted); }
  .sst-lumi-pack-toggle { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--lumiverse-text-muted); cursor: pointer; }
  .sst-lumi-pack-remove { font-size: 11px; padding: 3px 7px; border: 1px solid var(--lumiverse-border); border-radius: 6px; background: var(--lumiverse-fill); color: var(--lumiverse-text); cursor: pointer; }
  .sst-lumi-pack-remove:hover { color: #ff6b6b; border-color: #ff6b6b; }
  .sst-lumi-pack-import { font-size: 11px; padding: 5px 10px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); cursor: pointer; width: fit-content; }
  .sst-lumi-pack-hint { font-size: 10px; color: var(--lumiverse-text-muted); font-style: italic; }
  .sst-lumi-llm-section { border-bottom: 1px solid var(--lumiverse-border); }
  .sst-lumi-llm-summary { padding: 10px 12px; font-size: 12px; cursor: pointer; color: var(--lumiverse-text); user-select: none; }
  .sst-lumi-llm-summary:hover { background: var(--lumiverse-fill-subtle); }
  .sst-lumi-llm-controls { padding: 0 12px 10px; display: grid; gap: 8px; }
  .sst-lumi-llm-controls label { font-size: 11px; color: var(--lumiverse-text-muted); display: grid; gap: 5px; }
  .sst-lumi-llm-controls input[type="text"], .sst-lumi-llm-controls input[type="password"], .sst-lumi-llm-controls input[type="number"], .sst-lumi-llm-controls select { font-size: 12px; padding: 6px 8px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); }
  .sst-lumi-llm-model-mount { width: 100%; }
  .sst-tracker-generating { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 0; padding: 4px 10px; font-size: 11px; line-height: 1.4; color: var(--lumiverse-text-muted); background: color-mix(in srgb, var(--lumiverse-accent, #7c6aef) 12%, transparent); border: 1px solid color-mix(in srgb, var(--lumiverse-accent, #7c6aef) 30%, transparent); border-radius: 999px; }
  .sst-tracker-generating::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--lumiverse-accent, #7c6aef); animation: sst-tracker-generating-pulse 1.2s ease-in-out infinite; }
  @keyframes sst-tracker-generating-pulse { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }
  .sst-lumi-llm-regenerate { font-size: 11px; padding: 5px 10px; border: 1px solid var(--lumiverse-border); border-radius: 8px; background: var(--lumiverse-fill-subtle); color: var(--lumiverse-text); cursor: pointer; width: fit-content; }
  .sst-lumi-llm-regenerate:disabled { opacity: 0.5; cursor: not-allowed; }
  .sst-lumi-llm-status { font-size: 11px; color: var(--lumiverse-text-muted); min-height: 16px; }
  .sst-lumi-llm-status.sst-generating { color: var(--lumiverse-accent, #7c6aef); }
  .sst-lumi-llm-status.sst-error { color: #ff6b6b; }
  .sst-disabled { opacity: 0.5; pointer-events: none; }
  .sst-app-side-panel { position: fixed; top: 0; bottom: 0; width: 340px; z-index: 50; pointer-events: none; }
  .sst-app-side-panel.sst-app-side-right { right: 48px; }
  .sst-app-side-panel.sst-app-side-left { left: 0; }
  .sst-side-tracker-root { width: 100%; height: 100%; position: relative; overflow-y: auto; overflow-x: hidden; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; pointer-events: none; scrollbar-width: none; -ms-overflow-style: none; }
  .sst-side-tracker-root::-webkit-scrollbar { width: 0; height: 0; display: none; }
  .sst-side-tracker-root::-webkit-scrollbar-track { background: transparent; }
  .sst-side-tracker-root::-webkit-scrollbar-thumb { background: transparent; }
  .sst-side-tracker-root > #silly-sim-tracker-container { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; width: 100%; }
  .sst-side-tracker-root .sim-tracker-tab, .sst-side-tracker-root .sim-tracker-card { pointer-events: auto; }
  .sst-message-tracker-host { width: 100%; }
  .sst-theme-tactical #silly-sim-tracker-container { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--lumiverse-accent) 15%, transparent); }
`;
