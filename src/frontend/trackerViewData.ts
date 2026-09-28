import type { TrackerData } from "../shared/trackerData";

export function normalizeCharacters(data: TrackerData): Array<Record<string, unknown>> {
  if (Array.isArray(data.characters)) return data.characters;
  const out: Array<Record<string, unknown>> = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "worldData") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push({ name: key, ...(value as Record<string, unknown>) });
    }
  }
  return out;
}

function getDeepValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function findNumericPaths(obj: unknown, prefix = ""): string[] {
  const paths: string[] = [];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "number") {
        paths.push(path);
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        paths.push(...findNumericPaths(value, path));
      }
    }
  }
  return paths;
}

export function calculateStatChanges(currentCharacters: Array<Record<string, unknown>>, previous: TrackerData | null): Record<string, Record<string, unknown>> {
  const changes: Record<string, Record<string, unknown>> = {};
  if (!previous) {
    for (const char of currentCharacters) {
      const name = typeof char.name === "string" ? char.name : "Character";
      changes[name] = {};
    }
    return changes;
  }

  const prevChars = normalizeCharacters(previous);
  const prevByName = new Map<string, Record<string, unknown>>();
  for (const char of prevChars) {
    const name = typeof char.name === "string" ? char.name : "";
    if (name) prevByName.set(name, char);
  }

  for (const current of currentCharacters) {
    const name = typeof current.name === "string" ? current.name : "Character";
    const prev = prevByName.get(name);
    if (!prev) {
      changes[name] = {};
      continue;
    }

    const out: Record<string, unknown> = {};
    for (const path of findNumericPaths(prev)) {
      const curVal = getDeepValue(current, path);
      const prevVal = getDeepValue(prev, path);
      if (typeof curVal === "number" && typeof prevVal === "number") {
        out[`${path}Change`] = curVal - prevVal;
      }
    }
    changes[name] = out;
  }
  return changes;
}
