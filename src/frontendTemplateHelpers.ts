import Handlebars from "handlebars";
import { adjustColorBrightness, adjustHslColor } from "./colorUtils";
import {
  cycleStage,
  cycleStageId,
  cycleStageLabel,
  cervixState,
  cervixStateLabel,
  fertilityRiskLabel,
  fertilityRiskClass,
  hasMaleBiology,
  hasFemaleBiology,
  hasAnalTracking,
  hasProstateTracking,
  hasLactationTracking,
  milkPercent,
  isConceived,
  clampPercent,
  percentOf,
  maleFertilityLabel,
  maleFertilityPercent,
  semenPercent,
  wombFillTop,
  wombFillHeight,
  analFillTop,
  analFillHeight,
  semenFillTop,
  semenFillHeight,
  cervixOsR,
  cervixOsClass,
  vagShaftTopY,
  vagDepthBar,
  analShaftTopY,
} from "./frontendBiology";

let helpersRegistered = false;

export function registerTemplateHelpers(): void {
  if (helpersRegistered) return;
  helpersRegistered = true;

  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("eqi", (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase());
  Handlebars.registerHelper("cycleStage", cycleStage);
  Handlebars.registerHelper("cycleStageId", cycleStageId);
  Handlebars.registerHelper("cycleStageLabel", cycleStageLabel);
  Handlebars.registerHelper("cervixState", cervixState);
  Handlebars.registerHelper("cervixStateLabel", cervixStateLabel);
  Handlebars.registerHelper("cervixOsR", cervixOsR);
  Handlebars.registerHelper("cervixOsClass", cervixOsClass);
  Handlebars.registerHelper("fertilityRiskLabel", fertilityRiskLabel);
  Handlebars.registerHelper("fertilityRiskClass", fertilityRiskClass);
  Handlebars.registerHelper("hasFertilityTracking", hasFemaleBiology);
  Handlebars.registerHelper("hasRefractoryTracking", hasMaleBiology);
  Handlebars.registerHelper("hasMaleBiology", hasMaleBiology);
  Handlebars.registerHelper("hasFemaleBiology", hasFemaleBiology);
  Handlebars.registerHelper("isConceived", isConceived);
  Handlebars.registerHelper("clampPercent", clampPercent);
  Handlebars.registerHelper("percentOf", percentOf);
  Handlebars.registerHelper("maleFertilityLabel", maleFertilityLabel);
  Handlebars.registerHelper("maleFertilityPercent", maleFertilityPercent);
  Handlebars.registerHelper("semenPercent", semenPercent);
  Handlebars.registerHelper("wombFillTop", wombFillTop);
  Handlebars.registerHelper("wombFillHeight", wombFillHeight);
  Handlebars.registerHelper("vagShaftTopY", vagShaftTopY);
  Handlebars.registerHelper("vagDepthBar", vagDepthBar);
  Handlebars.registerHelper("analShaftTopY", analShaftTopY);
  Handlebars.registerHelper("hasAnalTracking", hasAnalTracking);
  Handlebars.registerHelper("hasProstateTracking", hasProstateTracking);
  Handlebars.registerHelper("hasLactationTracking", hasLactationTracking);
  Handlebars.registerHelper("milkPercent", milkPercent);
  Handlebars.registerHelper("analFillTop", analFillTop);
  Handlebars.registerHelper("analFillHeight", analFillHeight);
  Handlebars.registerHelper("semenFillTop", semenFillTop);
  Handlebars.registerHelper("semenFillHeight", semenFillHeight);
  // Variadic `or` / `and` — last argument is the Handlebars options
  // object, so we peel it off before folding. Values use JS truthiness
  // so `0`, `""`, `null`, `undefined`, and `false` are all falsy.
  Handlebars.registerHelper("or", function (...args: unknown[]) {
    const values = args.slice(0, -1);
    return values.some((v) => !!v);
  });
  Handlebars.registerHelper("and", function (...args: unknown[]) {
    const values = args.slice(0, -1);
    return values.every((v) => !!v);
  });
  Handlebars.registerHelper("not", (value: unknown) => !value);
  Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));
  Handlebars.registerHelper("gte", (a, b) => Number(a) >= Number(b));
  Handlebars.registerHelper("lt", (a, b) => Number(a) < Number(b));
  Handlebars.registerHelper("lte", (a, b) => Number(a) <= Number(b));
  Handlebars.registerHelper("abs", (a) => Math.abs(Number(a) || 0));
  Handlebars.registerHelper("multiply", (a, b) => (Number(a) || 0) * (Number(b) || 0));
  Handlebars.registerHelper("subtract", (a, b) => (Number(a) || 0) - (Number(b) || 0));
  Handlebars.registerHelper("add", (a, b) => (Number(a) || 0) + (Number(b) || 0));
  Handlebars.registerHelper("divide", (a, b) => {
    const divisor = Number(b) || 0;
    return divisor === 0 ? 0 : (Number(a) || 0) / divisor;
  });
  Handlebars.registerHelper("divideRoundUp", (a, b) => {
    const divisor = Number(b) || 0;
    return divisor === 0 ? 0 : Math.ceil((Number(a) || 0) / divisor);
  });
  Handlebars.registerHelper("tabZIndex", (i) => 5 - (Number(i) || 0));
  Handlebars.registerHelper("tabOffset", (i) => (Number(i) || 0) * 65);
  Handlebars.registerHelper("initials", (name) => (typeof name === "string" && name.length ? name.charAt(0).toUpperCase() : "?"));
  Handlebars.registerHelper("rawFirstLetter", (name) => (typeof name === "string" && name.length ? name.charAt(0) : "?"));
  Handlebars.registerHelper("slugifyUnderscore", (name) => (typeof name === "string" ? name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s-]+/g, "_") : ""));
  Handlebars.registerHelper("slugifyDash", (name) => (typeof name === "string" ? name.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-") : ""));
  Handlebars.registerHelper("camelCase", (name) => {
    if (typeof name !== "string") return "";
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((part, idx) => (idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join("");
  });
  Handlebars.registerHelper("adjustColorBrightness", (hexColor, brightnessPercent) =>
    adjustColorBrightness(String(hexColor || "#000000"), Number(brightnessPercent) || 100),
  );
  Handlebars.registerHelper("adjustHSL", (hexColor, hueShift, saturationAdjust, lightnessAdjust) =>
    adjustHslColor(
      String(hexColor || "#000000"),
      Number(hueShift) || 0,
      Number(saturationAdjust) || 0,
      Number(lightnessAdjust) || 0,
    ),
  );
}
