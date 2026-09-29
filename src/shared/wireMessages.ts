/** The host transports extension messages as unknown values. */
import type { TemplatePreset } from "./templatePresets";
import type { TrackerConfig } from "./trackerConfig";

export type FrontendToBackendMessage =
  | { type: "get_config" }
  | { type: "set_config"; config: TrackerConfig }
  | { type: "get_connections" }
  | { type: "get_latest_tracker"; chatId: string }
  | { type: "trigger_secondary_generation"; chatId: string; messageId: string }
  | { type: "regenerate_secondary_tracker"; chatId: string; messageId?: string; forceCharacterContext?: boolean }
  | { type: "delete_preset"; templateId: string }
  | { type: "import_preset_file"; fileName: string; text: string }
  | { type: "remove_inline_pack"; index: number }
  | { type: "toggle_inline_pack"; index: number; enabled: boolean }
  | { type: "message_tag_intercepted"; tagName: string; attrs: Record<string, string>; content: string; messageId?: string | null; chatId?: string | null; isStreaming?: boolean };

export type BackendToFrontendMessage =
  | { type: "config"; config: TrackerConfig; grantedPermissions: string[]; requestedPermissions: string[]; seededPresets: TemplatePreset[]; ephemeralPoolStatus: Record<string, unknown> | null }
  | { type: "tag_interceptor_config"; tagName: string; tagType: string; removeFromMessage: boolean }
  | { type: "config_saved" }
  | { type: "config_error"; message: string; operation: "load" | "save" }
  | { type: "connections_list"; connections: WireConnectionProfile[]; error?: string }
  | { type: "secondary_generation_started"; chatId: string; messageId: string }
  | { type: "secondary_generation_complete"; chatId: string; messageId: string; content: string; via: string }
  | { type: "secondary_generation_skipped"; chatId: string; messageId: string }
  | { type: "secondary_generation_error"; message: string; chatId?: string; messageId?: string }
  | { type: "tracker_history_latest"; chatId: string | null; entry: { messageId: string; payload: string; previousPayload: string | null } | null }
  | { type: "permission_changed"; permission: string; granted: boolean; allGranted: string[] }
  | { type: "import_result"; ok: boolean; message: string }
  | { type: "delete_preset_result"; ok: boolean; message: string }
  | { type: "command_result"; payload: Record<string, unknown> };

export type WireMessage = Record<string, unknown> & { type: string };

export type WireConnectionProfile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  is_default: boolean;
  has_api_key: boolean;
};

export function readWireRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readWireRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => readWireRecord(item) !== null)
    : [];
}

export function readWireTemplatePresets(value: unknown): TemplatePreset[] {
  return readWireRecords(value).filter((item): item is TemplatePreset & Record<string, unknown> =>
    typeof item.id === "string" && typeof item.templateName === "string"
    && (item.templateAuthor === undefined || typeof item.templateAuthor === "string")
    && (item.htmlTemplate === undefined || typeof item.htmlTemplate === "string")
    && (item.sysPrompt === undefined || typeof item.sysPrompt === "string")
    && (item.displayInstructions === undefined || typeof item.displayInstructions === "string")
    && (item.inlineTemplatesEnabled === undefined || typeof item.inlineTemplatesEnabled === "boolean")
    && (item.inlineTemplates === undefined || Array.isArray(item.inlineTemplates))
    && (item.templatePosition === undefined || typeof item.templatePosition === "string")
    && (item.customFields === undefined || (Array.isArray(item.customFields) && item.customFields.every((field) => {
      const record = readWireRecord(field);
      return record && typeof record.key === "string" && typeof record.description === "string";
    })))
    && (item.extSettings === undefined || readWireRecord(item.extSettings) !== null));
}

export function readWireConnectionProfiles(value: unknown): WireConnectionProfile[] {
  return readWireRecords(value).filter((item): item is WireConnectionProfile & Record<string, unknown> =>
    typeof item.id === "string" && typeof item.name === "string"
    && typeof item.provider === "string" && typeof item.model === "string"
    && typeof item.is_default === "boolean" && typeof item.has_api_key === "boolean");
}

export function readWireMessage(value: unknown): WireMessage | null {
  const record = readWireRecord(value);
  if (!record || typeof record.type !== "string") return null;
  if (record.type === "config" && !readWireRecord(record.config)) return null;
  if (record.type === "tracker_history_latest" && record.entry != null && !readWireRecord(record.entry)) return null;
  if (record.type === "command_result" && !readWireRecord(record.payload)) return null;
  if (record.type === "connections_list" && !Array.isArray(record.connections)) return null;
  return record as WireMessage;
}
