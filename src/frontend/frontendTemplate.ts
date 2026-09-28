import Handlebars from "handlebars";
import type { TemplatePreset } from "../shared/templatePresets";

export type TrackerMountMode = "message_top" | "message_bottom" | "side_left" | "side_right";

type CompiledTemplateCacheEntry = {
  source: string;
  compiled: Handlebars.TemplateDelegate;
};

const TEMPLATE_CACHE = new Map<string, CompiledTemplateCacheEntry>();

export function resolveTrackerMountMode(preset: TemplatePreset): TrackerMountMode {
  const fromPreset = typeof preset.templatePosition === "string" ? preset.templatePosition : "";
  const htmlTemplate = decodeTemplateHtml(preset.htmlTemplate);
  const fromHtml = htmlTemplate
    ? (htmlTemplate.match(/<!--\s*POSITION:\s*([A-Za-z_ -]+)\s*-->/i)?.[1] || "")
    : "";
  const raw = (fromPreset || fromHtml || "BOTTOM").trim().toUpperCase();
  if (raw === "TOP") return "message_top";
  if (raw === "LEFT") return "side_left";
  if (raw === "RIGHT") return "side_right";
  return "message_bottom";
}

function decodeTemplateHtml(htmlTemplate?: string): string {
  const raw = htmlTemplate || "";
  if (!/&lt;(?:!--|style|div|script|section|article|span)\b/i.test(raw)) return raw;

  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function extractTemplateLogic(htmlTemplate?: string): string | null {
  const decoded = decodeTemplateHtml(htmlTemplate);
  if (!decoded) return null;
  const scriptRegex = /<script\s+type=["']text\/x-handlebars-template-logic["'][^>]*>([\s\S]*?)<\/script>/i;
  const match = decoded.match(scriptRegex);
  if (!match?.[1]) return null;
  return match[1].trim();
}

export function executeTemplateLogic<T extends Record<string, unknown>>(
  input: T,
  templateType: "single" | "tabbed" | "tracker",
  preset: TemplatePreset,
): T {
  const logic = extractTemplateLogic(preset.htmlTemplate);
  if (!logic) return input;
  try {
    const fn = new Function("data", "templateType", `"use strict";\n${logic}\n; return data;`) as (data: T, templateType: string) => T;
    return fn(input, templateType);
  } catch {
    return input;
  }
}

function extractCardTemplate(htmlTemplate?: string): string {
  const raw = decodeTemplateHtml(htmlTemplate);
  const start = raw.indexOf("<!-- CARD_TEMPLATE_START -->");
  const end = raw.indexOf("<!-- CARD_TEMPLATE_END -->");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.substring(start + "<!-- CARD_TEMPLATE_START -->".length, end).trim();
  }
  return raw.trim();
}

export function compileTemplate(preset: TemplatePreset): Handlebars.TemplateDelegate | null {
  const html = extractCardTemplate(preset.htmlTemplate);
  if (!html) return null;
  const cached = TEMPLATE_CACHE.get(preset.id);
  if (cached?.source === html) return cached.compiled;
  try {
    const compiled = Handlebars.compile(html);
    TEMPLATE_CACHE.set(preset.id, { source: html, compiled });
    return compiled;
  } catch {
    return null;
  }
}
