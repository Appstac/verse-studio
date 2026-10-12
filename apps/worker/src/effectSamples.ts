// Renders the short looping preview of every effect shown in the website's effects
// gallery (apps/web/public/effects/<group>.<effect>.mp4), using the real templates.
// Usage: npx tsx src/effectSamples.ts <outDir> [onlyKeyFilter]
import fs from "node:fs";
import path from "node:path";
import { EFFECT_INFO } from "../../../shared/schema";
import type { BrandProps, ClipEditProps, ClipSegment, Grade } from "../remotion/types";
import { mount, startFileServer } from "./fileserver";
import { ffmpeg, probe } from "./media";
import { renderBackdrop, renderClipEdit } from "./render";

const out = path.resolve(process.argv[2] ?? "effects");
const only = process.argv[3];
fs.mkdirSync(out, { recursive: true });

const brand: BrandProps = {
  signatureText: "@yourhandle",
  handle: "@yourhandle",
  position: "bottom-center",
  opacity: 0.85,
  accent: "#F4C77B",
  outro: { enabled: false, text: "", seconds: 0 },
  watermark: { enabled: true, font: "clean", size: 30, style: "shadow", color: "#ffffff", showLogo: false },
};

async function main() {
  await startFileServer();
  // Two "shots" to cut between: warm candles and a blue stage.
  const a = await renderBackdrop("candles", "gold");
  const b = await renderBackdrop("beams", "ocean");
  const dir = path.dirname(a);
  const url = mount("samples", dir);
  const dur = (await probe(a)).duration;
  const shot = (f: string, start: number, end: number, extra: Partial<ClipSegment> = {}): ClipSegment => ({
    src: url(f),
    srcWidth: 1080,
    srcHeight: 1920,
    start,
    end: Math.min(end, dur),
    playbackRate: 1,
    zoom: "none",
    layout: "fill",
    ...extra,
  });
  const words = "He is faithful in every season of your life".split(" ").map((t, i) => ({ text: t, startMs: 300 + i * 330, endMs: 600 + i * 330 }));
  const lyrics = [
    { text: "Jesus, what a Savior", startMs: 200, endMs: 1700 },
    { text: "You meet me where I am", startMs: 1800, endMs: 3300 },
  ];
  const base = (p: Partial<ClipEditProps>): ClipEditProps => ({
    segments: [shot(a, 0, 3.5)],
    transition: "cut",
    captions: { words: [], style: "none", language: "english", look: { font: "clean", color: "#ffffff", highlight: "", size: "medium", position: "lower", background: "shadow", uppercase: false } },
    brand,
    keepAudio: false,
    preset: "night",
    editStyle: "professional",
    ...p,
  });
  const look = (g: Grade): ClipEditProps => base({ segments: [shot(a, 0, 3.5, { grade: 0 })], grades: [g] });
  const cap = (style: ClipEditProps["captions"]["style"], extra: Partial<ClipEditProps["captions"]> = {}) =>
    base({ captions: { ...base({}).captions, words, style, emphasis: ["faithful"], ...extra } });
  const samples: Record<string, ClipEditProps> = {
    "titles.card": base({ titleCard: { title: "Worthy of all praise", subtitle: "Grace Church choir", style: "card" } }),
    "titles.poster": base({ titleCard: { title: "Jesus what a Savior", header: "Worship Night", date: "October 2026", style: "poster" } }),
    "titles.recap": base({ segments: [shot(a, 0, 1.5), shot(b, 0, 2)], titleCard: { title: "June", subtitle: "recap", style: "recap" } }),
    "titles.pro": base({ hook: "When God makes a way" }),
    "captions.lines": cap("lines"),
    "captions.karaoke": cap("karaoke"),
    "captions.pop": base({ editStyle: "creator", captions: { ...base({}).captions, words, style: "pop", emphasis: ["faithful"], look: { ...base({}).captions.look!, font: "bold", position: "middle", size: "large" } } }),
    "captions.lyrics": base({ lyrics, captions: { ...base({}).captions, style: "lyrics", look: { ...base({}).captions.look!, font: "elegant" } } }),
    "captions.window": base({ lyrics, captions: { ...base({}).captions, style: "window", look: { ...base({}).captions.look!, highlight: "#e0559a" } } }),
    "captions.typewriter": base({ story: [{ text: "And tonight… we're just grateful.", startMs: 200, endMs: 3300 }] }),
    "transitions.cut": base({ segments: [shot(a, 0, 1.6), shot(b, 0, 1.9)] }),
    "transitions.dissolve": base({ transition: "fade", segments: [shot(a, 0, 1.9), shot(b, 0, 2.2)] }),
    "transitions.beat": base({ segments: [shot(a, 0, 0.67), shot(b, 0, 0.67), shot(a, 1, 1.67), shot(b, 1, 1.67), shot(a, 2, 2.67)] }),
    "moves.still": base({}),
    "moves.push": base({ segments: [shot(a, 0, 3.5, { zoom: "in", crop: 1.05 })] }),
    "moves.punch": base({ segments: [shot(a, 0, 1.7), shot(a, 1.7, 3.5, { zoom: "punch", focusY: 0.5 })] }),
    "moves.pan": base({ segments: [shot(b, 0, 3.5, { zoom: "pan", crop: 1.35, focusX: 0.2, focusEndX: 0.8, focusY: 0.4, focusEndY: 0.4 })] }),
    "looks.natural": look({ exposure: 0, contrast: 0, highlights: 0, saturation: 0, warmth: 0 }),
    "looks.warm": look({ exposure: 0.05, contrast: -0.05, highlights: 0.2, saturation: 0.05, warmth: 0.28 }),
    "looks.cinematic": look({ exposure: -0.05, contrast: 0.25, highlights: 0.35, saturation: -0.08, warmth: 0.1 }),
    "looks.airy": look({ exposure: 0.2, contrast: -0.2, highlights: 0.35, saturation: -0.12, warmth: 0.05 }),
    "looks.mono": look({ exposure: 0, contrast: 0.2, highlights: 0.2, saturation: -1, warmth: 0 }),
    "extras.story": base({ story: [{ text: "He was faithful.", startMs: 200, endMs: 3300 }] }),
    "extras.cards": base({ overlays: [{ src: url(b), type: "video", at: 0.3, duration: 3, position: "top", aspect: 9 / 16 }] }),
    "extras.endcard": base({ segments: [shot(a, 0, 1)], brand: { ...brand, outro: { enabled: true, title: "@yourhandle", text: "Follow for daily worship", seconds: 2.5 } } }),
    "extras.sfx": base({ editStyle: "creator", segments: [shot(a, 0, 1.6), shot(b, 0, 1.9)] }),
  };
  for (const [key, props] of Object.entries(samples)) {
    if (only && !key.includes(only)) continue;
    if (!EFFECT_INFO[key]) throw new Error(`No info for ${key}`);
    const tmp = path.join(out, `${key}.full.mp4`);
    const dest = path.join(out, `${key}.mp4`);
    if (fs.existsSync(dest)) continue;
    await renderClipEdit(props, tmp, undefined, { crf: 22, preset: "veryfast", scale: 1 });
    // Small, silent, loop-friendly preview for the website.
    await ffmpeg(["-i", tmp, "-vf", "scale=270:-2,fps=24", "-an", "-c:v", "libx264", "-crf", "30", "-preset", "slow", "-movflags", "+faststart", "-pix_fmt", "yuv420p", dest]);
    fs.rmSync(tmp, { force: true });
    console.log("rendered", key);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
