import type { Item, Rgba } from "./types.ts";

export interface AppearanceSettings {
  appearanceMode: "auto" | "original" | "light" | "dark";
  showPaper: boolean;
  showTemplate: boolean;
  adaptInk: boolean;
  neonMode: "auto" | "simple" | "glow";
}
export interface Appearance extends Omit<AppearanceSettings, "appearanceMode"> {
  mode: "original" | "light" | "dark";
  inkMode: "original" | "light" | "dark";
  simpleNeon: boolean;
}
export const DEFAULT_APPEARANCE: AppearanceSettings = {
  appearanceMode: "auto", showPaper: true, showTemplate: true, adaptInk: true, neonMode: "auto",
};
export function resolveAppearance(settings: AppearanceSettings, dark: boolean, mobile: boolean): Appearance {
  const theme = dark ? "dark" : "light";
  const mode = settings.appearanceMode === "auto" ? theme : settings.appearanceMode;
  return { ...settings, mode, inkMode: settings.showPaper ? mode : theme,
    simpleNeon: settings.neonMode === "simple" || (settings.neonMode === "auto" && mobile) };
}
export function adaptColor<T extends Rgba | null | undefined>(color: T, appearance: Appearance): T {
  if (!color || !appearance.adaptInk || appearance.mode === "original") return color;
  const [r,g,b,a] = color;
  if (![r,g,b].every(Number.isFinite) || Math.max(r,g,b)-Math.min(r,g,b)>20) return color;
  const lum=(r+g+b)/3;
  if (appearance.inkMode==="dark" && lum<65) return [229,229,232,a??255] as T;
  if (appearance.inkMode==="light" && lum>215) return [35,35,38,a??255] as T;
  return color;
}
export function adaptItem(item: Item, appearance: Appearance): Item {
  switch(item.kind) {
    case "stroke": return {...item,config:{...item.config,rgba:adaptColor(item.config.rgba,appearance),
      neon:appearance.simpleNeon ? false : item.config.neon}};
    case "shape": return {...item,stroke_rgba:adaptColor(item.stroke_rgba,appearance),
      fill_rgba:adaptColor(item.fill_rgba,appearance),neon:appearance.simpleNeon ? false : item.neon};
    case "table": return {...item,stroke_rgba:adaptColor(item.stroke_rgba,appearance)};
    case "text": return {...item,rgba:adaptColor(item.rgba,appearance)};
    // A dropped colour is a content fill, not necessarily ink; preserve its original colour.
    default: return item;
  }
}
