import { normalizeStoredConfig } from "./backendConfig";
import { DEFAULT_CONFIG, type TrackerConfig } from "./trackerConfig";

const TYPE_SAFE_ENCLAVE_KEY = "typesafe_api_key";
const CONFIG_PATH = "preferences.json";

export function createSettingsStore(deps: {
  getJson: (path: string, options: { fallback: Partial<TrackerConfig>; userId: string }) => Promise<Partial<TrackerConfig>>;
  setJson: (path: string, value: TrackerConfig, options: { indent: 2; userId: string }) => Promise<unknown>;
  enclaveGet: (key: string, userId: string) => Promise<string | null | undefined>;
  enclavePut: (key: string, value: string, userId: string) => Promise<unknown>;
  enclaveDelete: (key: string, userId: string) => Promise<unknown>;
  logError: (message: string) => void;
  logWarn: (message: string) => void;
}) {
  async function loadTypeSafeApiKey(userId: string): Promise<string> {
    try {
      return (await deps.enclaveGet(TYPE_SAFE_ENCLAVE_KEY, userId)) ?? "";
    } catch (err) {
      deps.logWarn(`Enclave unavailable; TypeSafe key not loaded: ${err instanceof Error ? err.message : String(err)}`);
    }
    return "";
  }

  async function loadConfig(userId: string, onNormalized: (config: TrackerConfig) => void): Promise<TrackerConfig> {
    if (!userId) throw new Error("A user id is required to load SimTracker settings.");
    try {
      const parsed = await deps.getJson(CONFIG_PATH, {
        fallback: { ...DEFAULT_CONFIG },
        userId,
      });
      const config = normalizeStoredConfig(parsed);
      onNormalized(config);
      // API key is resolved from the enclave, never from preferences.json.
      config.typeSafeApiKey = await loadTypeSafeApiKey(userId);
      return config;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logError(`Failed to load SimTracker settings for user ${userId}: ${message}`);
      throw new Error(`Unable to load saved settings: ${message}`);
    }
  }

  async function saveConfig(userId: string, configToSave: TrackerConfig): Promise<void> {
    if (!userId) throw new Error("A user id is required to save SimTracker settings.");
    await deps.setJson(CONFIG_PATH, { ...configToSave, typeSafeApiKey: "" }, { indent: 2, userId });
  }

  async function syncTypeSafeKeyToEnclave(userId: string, nextKey: string, previousKey: string): Promise<void> {
    const next = nextKey.trim();
    try {
      if (next && next !== previousKey) {
        await deps.enclavePut(TYPE_SAFE_ENCLAVE_KEY, next, userId);
      } else if (!next && previousKey) {
        await deps.enclaveDelete(TYPE_SAFE_ENCLAVE_KEY, userId);
      }
    } catch (err) {
      deps.logWarn(`Failed to persist the TypeSafe key to the enclave: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { loadConfig, saveConfig, syncTypeSafeKeyToEnclave };
}
