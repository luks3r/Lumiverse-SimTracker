import type { TrackerConfig } from "./trackerConfig";
import { buildImportedPreset, isInlinePackOnly } from "./importedPreset";

export function createImportService(deps: {
  hasEphemeralPermission: () => boolean;
  requestBlock: (bytes: number, options: { ttlMs: number; reason: string }) => Promise<{ reservationId: string }>;
  writeEphemeral: (path: string, text: string, options: { ttlMs: number; reservationId: string }) => Promise<unknown>;
  releaseBlock: (reservationId: string) => Promise<unknown>;
  sendToFrontend: (message: Record<string, unknown>, userId: string) => void;
  readConfig: () => TrackerConfig;
  writeConfig: (config: TrackerConfig) => void;
  saveConfig: (userId: string) => Promise<void>;
  pushMacroValues: () => void;
  sendConfigState: (userId: string) => Promise<void>;
  trackEvent: (
    eventName: string,
    payload?: Record<string, unknown>,
    options?: { level?: "debug" | "info" | "warn" | "error"; chatId?: string },
  ) => Promise<void>;
}) {
  return async function handleImportPresetFile(payload: Record<string, unknown>, userId: string): Promise<void> {
    const text = typeof payload.text === "string" ? payload.text : "";
    const fileName = typeof payload.fileName === "string" ? payload.fileName : "import.json";
    if (!text.trim()) {
      deps.sendToFrontend({
        type: "import_result",
        ok: false,
        message: "Import failed (empty file).",
      }, userId);
      return;
    }

    if (deps.hasEphemeralPermission()) {
      try {
        const encoded = new TextEncoder().encode(text);
        const reservation = await deps.requestBlock(encoded.byteLength, {
          ttlMs: 2 * 60 * 1000,
          reason: "sst import staging",
        });
        const path = `imports/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await deps.writeEphemeral(path, text, {
          ttlMs: 2 * 60 * 1000,
          reservationId: reservation.reservationId,
        });
        await deps.releaseBlock(reservation.reservationId);
      } catch {
        // Staging is optional for import flow.
      }
    }

    let parsed: Record<string, unknown>;
    try {
      const json = JSON.parse(text) as unknown;
      if (!json || typeof json !== "object") throw new Error("invalid");
      parsed = json as Record<string, unknown>;
    } catch {
      deps.sendToFrontend({
        type: "import_result",
        ok: false,
        message: "Import failed (invalid JSON).",
      }, userId);
      await deps.trackEvent("sst.import.failed", { reason: "invalid_json", fileName }, { level: "warn" });
      return;
    }

    if (isInlinePackOnly(parsed)) {
      const config = deps.readConfig();
      deps.writeConfig({ ...config, inlinePacks: [...config.inlinePacks, parsed] });
      await deps.saveConfig(userId);
      deps.pushMacroValues();
      await deps.sendConfigState(userId);
      deps.sendToFrontend({
        type: "import_result",
        ok: true,
        message: `Imported inline pack: ${String(parsed.templateName || "Unnamed")}`,
      }, userId);
      await deps.trackEvent("sst.import.inline_pack", { fileName }, { level: "info" });
      return;
    }

    const preset = buildImportedPreset(parsed, Date.now());
    const config = deps.readConfig();
    deps.writeConfig({
      ...config,
      userPresets: [...config.userPresets, preset],
      templateId: preset.id,
    });
    await deps.saveConfig(userId);
    deps.pushMacroValues();
    await deps.sendConfigState(userId);
    deps.sendToFrontend({
      type: "import_result",
      ok: true,
      message: `Imported preset: ${preset.templateName}`,
    }, userId);
    await deps.trackEvent("sst.import.preset", { fileName, templateId: preset.id }, { level: "info" });
  };
}
