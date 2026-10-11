import { FONTS } from "./fonts";
import type { Lang, PresetName } from "./types";

export interface PresetStyle {
  text: string;
  muted: string;
  accent: string;
  verseFont: string;
  verseItalic: boolean;
  verseWeight: number;
  hookFont: string;
  hookWeight: number;
  upper: boolean; // minimal style uses bold sans uppercase hooks
  shadow: string;
}

export function presetStyle(preset: PresetName, lang: Lang, accent: string): PresetStyle {
  const te = lang === "telugu";
  const base: PresetStyle = {
    text: "#FFF8EC",
    muted: "rgba(255,248,236,0.72)",
    accent,
    verseFont: te ? FONTS.teluguSerif : FONTS.serif,
    verseItalic: !te,
    verseWeight: te ? 500 : 500,
    hookFont: te ? FONTS.teluguSans : FONTS.display,
    hookWeight: te ? 600 : 500,
    upper: false,
    shadow: "0 2px 24px rgba(0,0,0,0.35)",
  };
  switch (preset) {
    case "paper":
      return {
        ...base,
        text: "#2B2118",
        muted: "rgba(43,33,24,0.66)",
        accent: "#8C3B2E",
        shadow: "none",
      };
    case "minimal":
      return {
        ...base,
        verseFont: te ? FONTS.teluguSans : FONTS.bold,
        verseItalic: false,
        verseWeight: 800,
        hookFont: te ? FONTS.teluguSans : FONTS.bold,
        hookWeight: 800,
        upper: !te,
        shadow: "none",
      };
    case "night":
      return { ...base, text: "#F5F7FF", muted: "rgba(220,228,255,0.7)" };
    case "garden":
      return { ...base, text: "#FBFFF4", muted: "rgba(240,250,230,0.72)" };
    default:
      return base;
  }
}
