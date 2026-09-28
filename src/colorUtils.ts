export function darkenColor(hex: string, amount = 20): string {
  const clean = hex.replace("#", "");
  const r = Math.max(0, parseInt(clean.slice(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(clean.slice(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(clean.slice(4, 6), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export function normalizeHexColor(value: unknown, fallback = "#6a5acd"): string {
  const clean = typeof value === "string" ? value.trim().replace(/^#/, "") : "";
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean}`;
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return `#${clean.split("").map((digit) => `${digit}${digit}`).join("")}`;
  }
  return fallback;
}

export function adjustColorBrightness(hex: string, brightnessPercent: number): string {
  const clean = (hex || "#000000").replace("#", "");
  const factor = Math.max(0, Math.min(100, brightnessPercent)) / 100;
  const r = Math.min(255, Math.max(0, Math.floor(parseInt(clean.substring(0, 2), 16) * factor)));
  const g = Math.min(255, Math.max(0, Math.floor(parseInt(clean.substring(2, 4), 16) * factor)));
  const b = Math.min(255, Math.max(0, Math.floor(parseInt(clean.substring(4, 6), 16) * factor)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hn = h / 360;
  const sn = s / 100;
  const ln = l / 100;
  if (sn === 0) {
    const gray = Math.round(ln * 255);
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

export function adjustHslColor(hex: string, hueShift: number, saturationAdjust: number, lightnessAdjust: number): string {
  const clean = (hex || "#000000").replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const hsl = rgbToHsl(r, g, b);

  let h = (hsl.h + hueShift) % 360;
  if (h < 0) h += 360;
  const s = Math.max(0, Math.min(100, hsl.s + saturationAdjust));
  const l = Math.max(0, Math.min(100, hsl.l + lightnessAdjust));
  const rgb = hslToRgb(h, s, l);
  return `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`;
}
