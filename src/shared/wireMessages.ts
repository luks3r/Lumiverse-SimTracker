/** The host transports extension messages as unknown values. Narrow only the envelope here. */
export type WireMessage = Record<string, unknown> & { type: string };

export function readWireRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readWireMessage(value: unknown): WireMessage | null {
  const record = readWireRecord(value);
  return record && typeof record.type === "string" ? record as WireMessage : null;
}
