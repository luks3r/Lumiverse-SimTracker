const FERTILITY_STAGE_BY_ID: Record<number, string> = {
  1: "menstruation",
  2: "follicular",
  3: "ovulation",
  4: "luteal",
  5: "pregnancy",
  6: "rut",
};

const FERTILITY_STAGE_ID_BY_NAME = Object.fromEntries(
  Object.entries(FERTILITY_STAGE_BY_ID).map(([id, name]) => [name, Number(id)]),
) as Record<string, number>;

const CERVIX_STATE_BY_ID: Record<number, string> = {
  0: "",
  1: "sealed",
  2: "firm",
  3: "soft",
  4: "open",
  5: "dilated",
  6: "kissed",
  7: "split",
};

export function cycleStage(stats: unknown): string {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return "";
  const record = stats as Record<string, unknown>;
  const stageId = Number(record.cycle_stage_id || record.cycleStageId || 0);
  if (FERTILITY_STAGE_BY_ID[stageId]) return FERTILITY_STAGE_BY_ID[stageId];
  return typeof record.cycle_stage === "string" ? record.cycle_stage.toLowerCase() : "";
}

export function cycleStageId(stats: unknown): number {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return 0;
  const record = stats as Record<string, unknown>;
  const stageId = Number(record.cycle_stage_id || record.cycleStageId || 0);
  if (FERTILITY_STAGE_BY_ID[stageId]) return stageId;
  return FERTILITY_STAGE_ID_BY_NAME[cycleStage(record)] || 0;
}

export function cycleStageLabel(stats: unknown): string {
  const stage = cycleStage(stats);
  if (!stage) return "Unknown";
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function cervixState(stats: unknown): string {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return "";
  const record = stats as Record<string, unknown>;
  const id = Number(record.cervix_state_id || record.cervixStateId || 0);
  if (CERVIX_STATE_BY_ID[id]) return CERVIX_STATE_BY_ID[id];
  const legacy = typeof record.cervix_state === "string" ? record.cervix_state.toLowerCase() : "";
  return legacy;
}

export function cervixStateLabel(stats: unknown): string {
  const state = cervixState(stats);
  if (!state) return "Unknown";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function fertilityRiskLabel(stats: unknown): string {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return "Unknown";
  const record = stats as Record<string, unknown>;
  const stage = cycleStage(record);
  if (record.preg === true || stage === "pregnancy") return "Pregnant";
  if (stage === "ovulation") return "High";
  if (stage === "luteal") return "Medium";
  if (stage === "menstruation" || stage === "follicular") return "Low";
  return "Unknown";
}

export function fertilityRiskClass(stats: unknown): string {
  const risk = fertilityRiskLabel(stats).toLowerCase();
  if (risk === "high") return "risk-high";
  if (risk === "medium") return "risk-med";
  if (risk === "pregnant") return "risk-preg";
  if (risk === "low") return "risk-low";
  return "risk-unknown";
}

function sexValue(stats: unknown): string {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return "";
  return String((stats as Record<string, unknown>).sex || "").toLowerCase();
}

export function hasMaleBiology(stats: unknown): boolean {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  const record = stats as Record<string, unknown>;
  const sex = sexValue(record);
  return (
    ["male", "futanari", "futa", "both", "intersex", "hermaphrodite"].includes(sex) ||
    Number(record.refractory_minutes) > 0 ||
    Number(record.semen_capacity_ml) > 0 ||
    Number(record.semen_ml) > 0 ||
    Number(record.male_fertility_pct) > 0
  );
}

export function hasFemaleBiology(stats: unknown): boolean {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  const record = stats as Record<string, unknown>;
  const sex = sexValue(record);
  const stage = cycleStage(record);
  return (
    ["female", "futanari", "futa", "both", "intersex", "hermaphrodite"].includes(sex) ||
    record.preg === true ||
    record.conceived === true ||
    Number(record.cycle_day) > 0 ||
    Number(record.womb_fullness_pct) > 0 ||
    Number(record.vag_depth_pct) > 0 ||
    ["pregnancy", "ovulation", "menstruation", "follicular", "luteal"].includes(stage)
  );
}

export function hasAnalTracking(stats: unknown): boolean {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  const record = stats as Record<string, unknown>;
  const sex = sexValue(record);
  return (
    ["male", "female", "futanari", "futa", "both", "intersex", "hermaphrodite"].includes(sex) ||
    Number(record.anal_fullness_pct) > 0 ||
    Number(record.anal_tightness_pct) > 0 ||
    Number(record.anal_depth_pct) > 0 ||
    Number(record.prostate_stimulation_pct) > 0
  );
}

export function hasProstateTracking(stats: unknown): boolean {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  const record = stats as Record<string, unknown>;
  const sex = sexValue(record);
  return (
    ["male", "futanari", "futa", "both", "intersex", "hermaphrodite"].includes(sex) ||
    Number(record.prostate_stimulation_pct) > 0
  );
}

export function hasLactationTracking(stats: unknown): boolean {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  const record = stats as Record<string, unknown>;
  const sex = sexValue(record);
  return (
    ["female", "futanari", "futa", "both", "intersex", "hermaphrodite"].includes(sex) ||
    record.lactating === true ||
    Number(record.milk_ml) > 0 ||
    Number(record.milk_capacity_ml) > 0 ||
    Number(record.breast_fullness_pct) > 0 ||
    Number(record.nipple_sensitivity_pct) > 0
  );
}

export function milkPercent(stats: unknown): number {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return 0;
  const record = stats as Record<string, unknown>;
  return percentOf(record.milk_ml, record.milk_capacity_ml);
}

// ── Cup-size driven breast geometry ──────────────────────────────────
//
// Each cup letter resolves to an (xScale, yScale) pair. The path generator
// scales the canonical anatomical teardrop outward (x) and downward (y)
// from a fixed chest-wall anchor at (50, 38). UK doubled letters and US
// triple-D notation are accepted as aliases for the next size up.

const CUP_SIZE_SCALE: Record<string, { x: number; y: number }> = {
  AA: { x: 0.55, y: 0.58 },
  A:  { x: 0.65, y: 0.70 },
  B:  { x: 0.78, y: 0.82 },
  C:  { x: 0.88, y: 0.90 },
  D:  { x: 1.00, y: 1.00 },
  DD: { x: 1.08, y: 1.08 },
  E:  { x: 1.08, y: 1.08 }, // EU = DD
  F:  { x: 1.13, y: 1.14 },
  G:  { x: 1.18, y: 1.21 },
  H:  { x: 1.22, y: 1.28 },
  I:  { x: 1.25, y: 1.32 },
  J:  { x: 1.28, y: 1.36 },
  K:  { x: 1.30, y: 1.40 },
};

const CUP_SIZE_ALIASES: Record<string, string> = {
  DDD: "F",
  FF: "G",
  GG: "H",
  HH: "I",
  II: "J",
  JJ: "K",
  KK: "K",
};

const CUP_SIZE_DEFAULT = CUP_SIZE_SCALE.C;

function sanitizeCupSize(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!cleaned) return "";
  const aliased = CUP_SIZE_ALIASES[cleaned];
  if (aliased) return aliased;
  return CUP_SIZE_SCALE[cleaned] ? cleaned : "";
}

function cupScaleFor(stats: unknown): { x: number; y: number } {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return CUP_SIZE_DEFAULT;
  const key = sanitizeCupSize((stats as Record<string, unknown>).cup_size);
  return key ? CUP_SIZE_SCALE[key] : CUP_SIZE_DEFAULT;
}

function cupSizeLabel(stats: unknown): string {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return "";
  const record = stats as Record<string, unknown>;
  if (typeof record.cup_size !== "string") return "";
  const raw = record.cup_size.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!raw) return "";
  // Show whatever the LLM emitted (uppercased) as long as it sanitizes to a known size.
  return sanitizeCupSize(raw) ? raw : "";
}

function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtCoord(n: number): string {
  const r = roundCoord(n);
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(2).replace(/\.?0+$/, "");
}

function buildBreastPath(side: "left" | "right", xS: number, yS: number): string {
  // Sign convention: -1 anchors the breast on the left half of the
  // viewBox, +1 mirrors to the right. Inward = toward center (50).
  const sgn = side === "left" ? -1 : 1;
  const center = 50;
  const top_y = 38;
  const apex_y = top_y + 26 * yS;
  const bottom_y = top_y + 52 * yS;

  const top_x = center + sgn * 18;
  const outer_x = center + sgn * 40 * xS;
  const bottom_x = center + sgn * 20;
  const inner_x = center + sgn * 4;

  // Segment 1: top → outer apex
  const c1a_x = top_x + (outer_x - top_x) * 0.45;
  const c1a_y = top_y;
  const c1b_x = outer_x + (-sgn) * 2;
  const c1b_y = apex_y - 16 * yS;
  // Segment 2: outer apex → bottom
  const c2a_x = outer_x + sgn * 2;
  const c2a_y = apex_y + 16 * yS;
  const c2b_x = bottom_x + sgn * 14 * xS;
  const c2b_y = bottom_y;
  // Segment 3: bottom → inner apex
  const c3a_x = bottom_x + (-sgn) * 12 * xS;
  const c3a_y = bottom_y;
  const c3b_x = inner_x;
  const c3b_y = apex_y + 16 * yS;
  // Segment 4: inner apex → top
  const c4a_x = inner_x;
  const c4a_y = apex_y - 14 * yS;
  const c4b_x = top_x + (-sgn) * 8;
  const c4b_y = top_y;

  const F = fmtCoord;
  return [
    `M ${F(top_x)} ${F(top_y)}`,
    `C ${F(c1a_x)} ${F(c1a_y)}, ${F(c1b_x)} ${F(c1b_y)}, ${F(outer_x)} ${F(apex_y)}`,
    `C ${F(c2a_x)} ${F(c2a_y)}, ${F(c2b_x)} ${F(c2b_y)}, ${F(bottom_x)} ${F(bottom_y)}`,
    `C ${F(c3a_x)} ${F(c3a_y)}, ${F(c3b_x)} ${F(c3b_y)}, ${F(inner_x)} ${F(apex_y)}`,
    `C ${F(c4a_x)} ${F(c4a_y)}, ${F(c4b_x)} ${F(c4b_y)}, ${F(top_x)} ${F(top_y)}`,
    "Z",
  ].join(" ");
}

interface BreastGeometry {
  pathLeft: string;
  pathRight: string;
  fillTop: number;
  fillHeight: number;
  fillSurfaceMid: number;
  apexY: number;
  bottomY: number;
  apexXLeft: number;
  apexXRight: number;
  areolaY: number;
  areolaR: number;
  nippleR: number;
  cleavagePath: string;
  foldLeftPath: string;
  foldRightPath: string;
  glossXLeft: number;
  glossXRight: number;
  glossY: number;
  glossRX: number;
  glossRY: number;
  cupLabel: string;
}

export function computeBreastGeometry(stats: unknown): BreastGeometry {
  const { x: xS, y: yS } = cupScaleFor(stats);

  const top_y = 38;
  const apex_y = top_y + 26 * yS;
  const bottom_y = top_y + 52 * yS;

  const pathLeft = buildBreastPath("left", xS, yS);
  const pathRight = buildBreastPath("right", xS, yS);

  const fullness = stats && typeof stats === "object" && !Array.isArray(stats)
    ? clampPercent((stats as Record<string, unknown>).breast_fullness_pct)
    : 0;
  const range = bottom_y - top_y;
  const fillTop = bottom_y - (fullness / 100) * range;
  const fillHeight = (fullness / 100) * range;

  const outer_x_left = 50 - 40 * xS;
  const outer_x_right = 50 + 40 * xS;
  const inner_x_left = 46;
  const inner_x_right = 54;
  const apexXLeft = (outer_x_left + inner_x_left) / 2;
  const apexXRight = (outer_x_right + inner_x_right) / 2;

  const areolaY = apex_y + 8 * yS;
  const areolaR = Math.max(2.5, Math.min(6.0, 4.6 * yS));
  const nippleR = Math.max(1.2, Math.min(2.5, 1.8 * yS));

  const cleavTop = apex_y - 10;
  const cleavMid = apex_y - 2;
  const cleavBotMid = apex_y + 10;
  const cleavBot = apex_y + 18;
  const cleavagePath = `M 50 ${fmtCoord(cleavTop)} C 48 ${fmtCoord(cleavMid)}, 48 ${fmtCoord(cleavBotMid)}, 50 ${fmtCoord(cleavBot)}`;

  const foldY = bottom_y - 4;
  const foldDipY = bottom_y + 3;
  const foldLeftPath = `M 14 ${fmtCoord(foldY)} C 22 ${fmtCoord(foldDipY)}, 38 ${fmtCoord(foldDipY)}, 45 ${fmtCoord(foldY)}`;
  const foldRightPath = `M 86 ${fmtCoord(foldY)} C 78 ${fmtCoord(foldDipY)}, 62 ${fmtCoord(foldDipY)}, 55 ${fmtCoord(foldY)}`;

  const glossY = top_y + (apex_y - top_y) * 0.45;
  const glossXLeft = 32 + (outer_x_left - 32) * 0.4;
  const glossXRight = 68 + (outer_x_right - 68) * 0.4;
  // Gloss scales with the breast so the highlight stays proportional — contracts
  // for small cups (so it doesn't bleed past the outline) and stretches for large
  // ones, with sensible floors and ceilings.
  const glossRX = Math.max(5, Math.min(16, 11 * xS));
  const glossRY = Math.max(3, Math.min(10, 6.5 * yS));

  return {
    pathLeft,
    pathRight,
    fillTop: roundCoord(fillTop),
    fillHeight: roundCoord(fillHeight),
    fillSurfaceMid: roundCoord(fillTop + 3),
    apexY: roundCoord(apex_y),
    bottomY: roundCoord(bottom_y),
    apexXLeft: roundCoord(apexXLeft),
    apexXRight: roundCoord(apexXRight),
    areolaY: roundCoord(areolaY),
    areolaR: roundCoord(areolaR),
    nippleR: roundCoord(nippleR),
    cleavagePath,
    foldLeftPath,
    foldRightPath,
    glossXLeft: roundCoord(glossXLeft),
    glossXRight: roundCoord(glossXRight),
    glossY: roundCoord(glossY),
    glossRX: roundCoord(glossRX),
    glossRY: roundCoord(glossRY),
    cupLabel: cupSizeLabel(stats),
  };
}

export function isConceived(stats: unknown): boolean {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  const record = stats as Record<string, unknown>;
  return record.conceived === true && record.preg !== true;
}

export function clampPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)));
}

export function percentOf(value: unknown, total: unknown): number {
  const denominator = Number(total);
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return clampPercent(((Number(value) || 0) / denominator) * 100);
}

export function maleFertilityLabel(stats: unknown): string {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return "Unknown";
  const record = stats as Record<string, unknown>;
  const pct = Number(record.male_fertility_pct ?? record.sperm_count_pct);
  if (!Number.isFinite(pct)) return "Unknown";
  if (pct >= 80) return "Very high";
  if (pct >= 60) return "High";
  if (pct >= 35) return "Average";
  if (pct >= 15) return "Low";
  return "Very low";
}

export function maleFertilityPercent(stats: unknown): number {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return 0;
  const record = stats as Record<string, unknown>;
  return clampPercent(record.male_fertility_pct ?? record.sperm_count_pct);
}

export function semenPercent(stats: unknown): number {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return 0;
  const record = stats as Record<string, unknown>;
  return percentOf(record.semen_ml, record.semen_capacity_ml);
}

export function wombFillTop(value: unknown): number {
  const pct = clampPercent(value);
  // Inner cavity spans y≈24 (top) to y≈88 (bottom) → height 64
  return 88 - (pct / 100) * 64;
}

export function wombFillHeight(value: unknown): number {
  const pct = clampPercent(value);
  return (pct / 100) * 64;
}

export function analFillTop(value: unknown): number {
  const pct = clampPercent(value);
  // Inner cavity spans y≈15 (top) to y≈105 (bottom) → height 90
  return 105 - (pct / 100) * 90;
}

export function analFillHeight(value: unknown): number {
  const pct = clampPercent(value);
  return (pct / 100) * 90;
}

export function semenFillTop(value: unknown): number {
  const pct = clampPercent(value);
  // Testicle fill spans y≈86 to y≈130 → height 44
  return 130 - (pct / 100) * 44;
}

export function semenFillHeight(value: unknown): number {
  const pct = clampPercent(value);
  return (pct / 100) * 44;
}

// ── Cervical os & penetration-depth geometry ─────────────────────────
//
// The womb vessel's SVG uses viewBox 0 0 100 160: the uterine cavity spans
// y≈24-88 (unchanged), the cervical os sits at (50, 90), and the vaginal
// canal runs down to the introitus at y=148. vag_depth_pct maps onto that
// span — 100 = hilted at the os. Values past 100 (only valid while the
// cervix is split) push the tip up into the womb cavity, capped at 130 =
// mid-cavity beside the pregnancy seed position.

const CERVIX_OS_RADIUS: Record<string, number> = {
  "": 1.6,
  sealed: 0.6,
  firm: 1.3,
  soft: 2.2,
  open: 3.2,
  dilated: 4.2,
  kissed: 4.6,
  split: 5.4,
};

const VAG_INTROITUS_Y = 148;
const VAG_OS_Y = 90;
const VAG_OVERDRIVE_MAX = 30;
const VAG_OVERDRIVE_SPAN = 32;

const ANAL_OPENING_Y = 103;
const ANAL_DEEP_Y = 22;

export function cervixOsR(stats: unknown): number {
  const state = cervixState(stats);
  return CERVIX_OS_RADIUS[state] ?? CERVIX_OS_RADIUS[""];
}

export function cervixOsClass(stats: unknown): string {
  const state = cervixState(stats);
  return state ? `os-${state}` : "os-unknown";
}

function vagDepthValue(stats: unknown): number {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return 0;
  const depth = Number((stats as Record<string, unknown>).vag_depth_pct);
  return Number.isFinite(depth) && depth > 0 ? depth : 0;
}

export function vagShaftTopY(stats: unknown): number {
  const depth = vagDepthValue(stats);
  if (depth <= 0) return VAG_INTROITUS_Y;
  if (depth <= 100) return VAG_INTROITUS_Y - (depth / 100) * (VAG_INTROITUS_Y - VAG_OS_Y);
  const over = Math.min(depth - 100, VAG_OVERDRIVE_MAX);
  return VAG_OS_Y - (over / VAG_OVERDRIVE_MAX) * VAG_OVERDRIVE_SPAN;
}

export function vagDepthBar(stats: unknown): number {
  // Depth meter scale: 0-130 mapped to 0-100% so the "cervix line" marker
  // at 100/130 sits at a fixed position on the track.
  const depth = vagDepthValue(stats);
  return Math.round((Math.min(depth, 100 + VAG_OVERDRIVE_MAX) / (100 + VAG_OVERDRIVE_MAX)) * 100);
}

export function analShaftTopY(stats: unknown): number {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return ANAL_OPENING_Y;
  const depth = clampPercent((stats as Record<string, unknown>).anal_depth_pct);
  if (depth <= 0) return ANAL_OPENING_Y;
  return ANAL_OPENING_Y - (depth / 100) * (ANAL_OPENING_Y - ANAL_DEEP_Y);
}
