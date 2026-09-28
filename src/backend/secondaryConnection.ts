// Spindle can seed the connection model field with a schema placeholder.
const MODEL_PLACEHOLDERS = new Set(["", "string", "model", "your-model-here", "null", "undefined"]);

type ConnectionLike = { id: string; provider?: unknown; model?: unknown; is_default?: unknown };

export function resolveSecondaryConnection<T extends ConnectionLike>(
  connections: T[],
  selectedConnectionId: string,
  configuredModel: string,
): { ok: true; connection: T; provider: string; model: string } | { ok: false; reason: "provider" | "model"; model: string } {
  const connection = selectedConnectionId
    ? connections.find((item) => item.id === selectedConnectionId)
    : connections.find((item) => item.is_default);
  const provider = typeof connection?.provider === "string" ? connection.provider.trim() : "";
  if (!connection || !provider) return { ok: false, reason: "provider", model: configuredModel };

  let model = configuredModel;
  if (MODEL_PLACEHOLDERS.has(model.toLowerCase())) {
    model = typeof connection.model === "string" ? connection.model.trim() : "";
  }
  if (MODEL_PLACEHOLDERS.has(model.toLowerCase())) {
    return { ok: false, reason: "model", model };
  }
  return { ok: true, connection, provider, model };
}
