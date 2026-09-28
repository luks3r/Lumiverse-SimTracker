export function setDeep(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return;

  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const existing = cursor[key];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

/**
 * Pick the example value for a custom field that will be baked into the
 * `{{sim_format}}` example block the LLM sees. The chosen value is what
 * the model imitates, so its JSON type matters — if a numeric enum like
 * `last_react` gets the default `""` fallback, the model emits
 * `"last_react": "0"` (a quoted string) instead of `"last_react": 0`.
 *
 * Resolution order, first match wins:
 *   1. Explicit type marker in the description, e.g. `[number]`,
 *      `(number)`, `[boolean]`, `[string]`, `[array]`. Template authors
 *      can force a type regardless of what the heuristic would guess.
 *   2. Well-known special-purpose keys (`name`, `*date*`, `*time*`,
 *      `bg`/`color`).
 *   3. Enum-style descriptions with `<digit>=<label>` pairs
 *      (`"0=Neutral, 1=Like"`). These are numeric codes — never strings.
 *   4. Numeric range descriptions (`(0-200)`, `(-100 to 100)`).
 *   5. Exact-match boolean keys (`preg`, `inactive`, `alive`) and
 *      descriptions explicitly calling out `true/false` / `boolean`.
 *      Exact-match is critical here so compound keys like `days_preg`
 *      and `inactiveReason` are NOT classified as booleans.
 *   6. Plain short-text keys (`*icon*`, `*thought*`, `*status*`).
 *   7. Arrays — description mentions "array" or the connection shape.
 *   8. Numeric key signals (game-stat abbreviations and domain terms
 *      such as `react`, `reason`, `index`, `days`, `level`).
 *   9. Plural keys → arrays as a final guess.
 *   10. Fallback to empty string.
 */
export function inferExampleValue(key: string, description: string): unknown {
  const k = key.toLowerCase();
  const d = description.toLowerCase();

  // 1. Well-known special-purpose keys first so their informative
  //    placeholders (`"YYYY-MM-DD"`, `"HEX_COLOR"`) aren't overwritten
  //    by a generic empty-string default when the template author adds
  //    a `[string]` type marker to the same field.
  if (k === "name") return "Character Name";
  if (k.includes("date") && k.includes("time")) return "YYYY-MM-DD HH:MM";
  if (k.includes("date")) return "YYYY-MM-DD";
  if (k.includes("time")) return "HH:MM";
  if (k.includes("bg") || k.includes("color")) return "HEX_COLOR";

  // 2. Explicit type hints in the description override the remaining
  //    heuristics. Supported markers: `[number]`, `[integer]`, `[int]`,
  //    `[float]`, `[boolean]`, `[bool]`, `[string]`, `[text]`,
  //    `[array]`, `[list]`, and the `(...)` parenthesised variants.
  if (/[\[(](?:number|integer|int|float)[\])]/.test(d)) return 0;
  if (/[\[(](?:boolean|bool)[\])]/.test(d)) return false;
  if (/[\[(](?:string|text)[\])]/.test(d)) return "";
  if (/[\[(](?:array|list)[\])]/.test(d)) {
    if (k.includes("connection")) return [{ name: "Target", affinity: 0 }];
    return [];
  }

  // 3. Enum-style descriptions: "0=Neutral, 1=Like, 2=Dislike". These
  //    are numeric codes, NOT strings — that's the whole point of this
  //    rewrite. Must be detected before any string / boolean fallback.
  if (/\b\d+\s*=/.test(d)) return 0;

  // 4. Numeric range descriptions: "(0-200)", "(-100 to 100)",
  //    "(0 to 100)", "(1 - 20)". Any two numbers separated by a dash or
  //    the word "to" marks the field as numeric.
  if (/-?\d+\s*(?:to|[-–—])\s*-?\d+/.test(d)) return 0;

  // 5. Booleans — use EXACT key matches so compound keys like
  //    `days_preg` (count of days) and `inactiveReason` (enum code)
  //    aren't mis-classified as booleans.
  if (k === "preg" || k === "inactive" || k === "alive" || k === "dead") return false;
  if (/\btrue\/false\b|\bboolean\b/.test(d)) return false;

  // 6. Plain short-text keys.
  if (k.includes("icon") || k.includes("thought") || k.includes("status")) return "";

  // 7. Arrays.
  if (d.includes("array") || d.includes("[{")) {
    if (k.includes("connection")) return [{ name: "Target", affinity: 0 }];
    return [];
  }

  // 8. Numeric-leaning key patterns. Explicitly includes `react` and
  //    `reason` so `last_react` and `inactiveReason` are caught even
  //    without enum syntax in the description.
  const numericKeySignals = [
    "ap", "dp", "tp", "cp", "hp", "mp", "xp", "sp",
    "affection", "desire", "trust", "contempt", "affinity",
    "health", "vitality", "level", "turn", "count",
    "days", "months", "years", "hours", "minutes",
    "score", "points", "rating", "index",
    "react", "reason",
  ];
  if (numericKeySignals.some((term) => k.includes(term))) return 0;
  if (d.includes("number")) return 0;

  // 9. Plural key → array (weak signal; ignore common non-plural
  //    endings like `-us`, `-ss`, `-is`).
  if (k.endsWith("s") && !k.endsWith("us") && !k.endsWith("ss") && !k.endsWith("is")) {
    if (k.includes("connection")) return [{ name: "Target", affinity: 0 }];
    return [];
  }

  return "";
}
