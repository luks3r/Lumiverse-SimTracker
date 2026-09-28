import { sanitizeSinglePreset } from "./presetSanitizers";
import type { TemplatePreset } from "./templatePresets";

type StorageStat = { exists: boolean; isDirectory: boolean; isFile: boolean };

export async function discoverSeededPresets(storage: {
  exists: (path: string) => Promise<boolean>;
  list: (path: string) => Promise<string[]>;
  stat: (path: string) => Promise<StorageStat>;
  getJson: (path: string) => Promise<Record<string, unknown>>;
}): Promise<TemplatePreset[]> {
  const seeded: TemplatePreset[] = [];
  try {
    const templatesRoot = "templates";
    const hasTemplatesDir = await storage.exists(templatesRoot);
    if (!hasTemplatesDir) return [];

    const visited = new Set<string>();
    const jsonPaths = new Set<string>();

    const toStoragePath = (entry: string, base: string): string => {
      const normalized = entry.replace(/^\/+/, "").replace(/\\/g, "/");
      if (!normalized) return base;
      if (normalized === base || normalized.startsWith(`${base}/`)) return normalized;
      return `${base}/${normalized}`;
    };

    const walk = async (dirPath: string): Promise<void> => {
      if (visited.has(dirPath)) return;
      visited.add(dirPath);

      const entries = await storage.list(dirPath);
      for (const entry of entries) {
        const fullPath = toStoragePath(entry, dirPath);
        try {
          const stat = await storage.stat(fullPath);
          if (!stat.exists) continue;
          if (stat.isDirectory) {
            await walk(fullPath);
            continue;
          }
          if (stat.isFile && fullPath.toLowerCase().endsWith(".json")) {
            jsonPaths.add(fullPath);
          }
        } catch {
          // Ignore unreadable path and continue traversal.
        }
      }
    };

    await walk(templatesRoot);

    for (const path of jsonPaths) {
      try {
        const stat = await storage.stat(path);
        if (!stat.exists || !stat.isFile) continue;
        const fileName = path.split("/").pop() || "seeded-template";
        const fileId = fileName.replace(/\.json$/i, "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
        const parsed = await storage.getJson(path);
        const preset = sanitizeSinglePreset(parsed, fileId);
        if (preset && preset.htmlTemplate) {
          seeded.push(preset);
        }
      } catch {
        // Skip invalid seed files.
      }
    }
  } catch {
    // Ignore seed loading failures and continue with bundled presets.
  }

  return seeded;
}
