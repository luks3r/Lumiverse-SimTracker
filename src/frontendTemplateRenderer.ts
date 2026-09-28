import type { TemplatePreset } from "./templatePresets";
import type { TrackerData } from "./trackerData";
import { calculateStatChanges, normalizeCharacters } from "./trackerViewData";
import { compileTemplate, executeTemplateLogic } from "./frontendTemplate";
import { darkenColor, normalizeHexColor } from "./colorUtils";
import { computeBreastGeometry } from "./frontendBiology";

type CharacterStats = Record<string, unknown>;

function getReactionEmoji(value: unknown): string {
  const num = Number(value);
  if (num === 1) return "❤️";
  if (num === 2) return "😡";
  return "😐";
}

function buildTemplateData(
  data: TrackerData,
  preset: TemplatePreset,
  previousData: TrackerData | null,
): {
  renderMode: "single" | "tabbed" | "tracker";
  input: Record<string, unknown>;
  fallbackRaw: string;
} {
  const worldData = (data.worldData || {}) as Record<string, unknown>;
  const configuredMaxCharacters = Number(preset.extSettings?.maxCharacters);
  const maxCharacters = Number.isFinite(configuredMaxCharacters) && configuredMaxCharacters > 0
    ? Math.floor(configuredMaxCharacters)
    : Number.POSITIVE_INFINITY;
  const characters = normalizeCharacters(data).slice(0, maxCharacters);
  const currentDate = typeof worldData.current_date === "string" ? worldData.current_date : "Unknown Date";
  const currentTime = typeof worldData.current_time === "string" ? worldData.current_time : "Unknown Time";
  const tabbed = (preset.htmlTemplate || "").includes("sim-tracker-tabs") || preset.id.includes("tabs");
  // Positioned templates normally compile once per character. Tracker mode is
  // an explicit opt-in for layouts that need one world panel around all cards.
  const trackerLevel = preset.extSettings?.renderMode === "tracker";
  const statChanges = calculateStatChanges(characters, previousData);

  const characterPayload = characters.map((character) => {
    const stats = character as CharacterStats;
    const name = typeof stats.name === "string" ? stats.name : "Character";
    const bgColor = normalizeHexColor(stats.bg);

    const isNestedStats =
      stats && typeof stats === "object" && typeof stats.stats === "object" && stats.stats !== null;

    const templateStats: CharacterStats = isNestedStats
      ? { ...stats, ...(stats.stats as CharacterStats) }
      : { ...stats };

    // Remove the nested stats reference to avoid shadowing / confusion
    if (isNestedStats) {
      delete templateStats.stats;
    }

    const normalizedCycleStage =
      typeof templateStats.cycle_stage === "string" ? templateStats.cycle_stage.toLowerCase() : templateStats.cycle_stage;
    const normalizedSex = typeof templateStats.sex === "string" ? templateStats.sex.toLowerCase() : templateStats.sex;

    const resolvedStats = {
      ...templateStats,
      sex: normalizedSex,
      cycle_stage: normalizedCycleStage,
      ...(statChanges[name] || {}),
      internal_thought: stats.internal_thought || stats.thought || "No thought recorded.",
      relationshipStatus: stats.relationshipStatus || "Unknown Status",
      desireStatus: stats.desireStatus || "Unknown Desire",
      inactive: Boolean(stats.inactive),
      inactiveReason: Number(stats.inactiveReason || 0),
    };

    return {
      name,
      characterName: name,
      currentDate,
      currentTime,
      stats: resolvedStats,
      breastGeometry: computeBreastGeometry(resolvedStats),
      bgColor,
      darkerBgColor: darkenColor(bgColor),
      reactionEmoji: getReactionEmoji(stats.last_react),
      healthIcon: Number(stats.health) === 1 ? "🤕" : Number(stats.health) === 2 ? "💀" : null,
      showThoughtBubble: true,
    };
  });

  if (tabbed || trackerLevel) {
    return {
      renderMode: trackerLevel ? "tracker" : "tabbed",
      input: {
        characters: characterPayload,
        worldData,
        currentDate,
        currentTime,
      },
      fallbackRaw: JSON.stringify(data, null, 2),
    };
  }

  return {
    renderMode: "single",
    input: {
      characters: characterPayload,
      worldData,
      currentDate,
      currentTime,
    },
    fallbackRaw: JSON.stringify(data, null, 2),
  };
}

export function buildTrackerMarkup(
  data: TrackerData,
  preset: TemplatePreset,
  previousData: TrackerData | null,
): { html: string | null; fallbackRaw: string } {

  const compiled = compileTemplate(preset);
  if (!compiled) {
    return { html: null, fallbackRaw: rawJson(data) };
  }

  const prep = buildTemplateData(data, preset, previousData);
  try {
    let cardsHtml = "";
    if (prep.renderMode !== "single") {
      const transformed = executeTemplateLogic(prep.input, prep.renderMode, preset);
      cardsHtml = compiled(transformed);
    } else {
      const inputChars = ((prep.input.characters as Array<Record<string, unknown>>) || []);
      cardsHtml = inputChars.map((item) => compiled(executeTemplateLogic(item, "single", preset))).join("");
    }
    const wrapped = `<div id="silly-sim-tracker-container" style="width:100%;">${cardsHtml}</div>`;
    return { html: wrapped, fallbackRaw: prep.fallbackRaw };
  } catch {
    return { html: null, fallbackRaw: prep.fallbackRaw };
  }
}

function rawJson(data: TrackerData): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return "{}";
  }
}
