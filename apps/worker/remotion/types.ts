// Props passed from the worker into the Remotion compositions.
// Kept free of zod so the Remotion bundle stays small.

export type PresetName = "dawn" | "night" | "paper" | "minimal" | "garden" | "photo" | "footage";
export type Lang = "english" | "telugu";

export type BrandProps = {
  signatureText: string;
  logoSrc?: string;
  position: "bottom-center" | "bottom-left" | "top-left" | "top-center" | "top-right";
  opacity: number;
  accent: string;
  outro: { enabled: boolean; text: string; seconds: number };
  handle: string;
}

export type MediaRef = {
  type: "video" | "image";
  src: string;
  durationSeconds?: number;
}

export type VerseReelProps = {
  preset: PresetName;
  language: Lang;
  hook?: string;
  verseText: string;
  reference: string;
  emphasis?: string[];
  background?: MediaRef;
  brand: BrandProps;
  verseSeconds: number;
  hookSeconds: number;
  seed: number;
}

export type SlideProps = {
  preset: PresetName;
  language: Lang;
  kind: "cover" | "body" | "cta";
  index: number;
  total: number;
  title: string;
  body?: string;
  reference?: string;
  background?: MediaRef;
  brand: BrandProps;
  seed: number;
}

export type CaptionWord = {
  text: string;
  startMs: number;
  endMs: number;
}

export type ClipSegment = {
  src: string;
  srcWidth: number;
  srcHeight: number;
  start: number; // seconds in source
  end: number; // seconds in source
  playbackRate: number;
  zoom: "none" | "in" | "out" | "punch";
  layout: "fill" | "blur-pad";
  textOverlay?: string;
}

export type Overlay = {
  src: string;
  type: "image" | "video";
  at: number; // seconds on the output timeline
  duration: number;
  position: "top" | "center" | "corner";
  aspect: number; // width / height
};

export type ClipEditProps = {
  segments: ClipSegment[];
  transition: "cut" | "fade";
  captions: { words: CaptionWord[]; style: "pop" | "karaoke" | "lines" | "none"; language: Lang; emphasis?: string[] };
  overlays?: Overlay[];
  sfx?: { whoosh?: string; pop?: string };
  cta?: string;
  hook?: string;
  brand: BrandProps;
  keepAudio: boolean;
  preset: PresetName;
}

export const FPS = 30;
export const REEL = { width: 1080, height: 1920 };
export const SLIDE = { width: 1080, height: 1350 };
export const TRANSITION_FRAMES = 8;

export function clipEditFrames(p: ClipEditProps): number {
  let frames = 0;
  for (const s of p.segments) {
    frames += Math.max(1, Math.round(((s.end - s.start) / s.playbackRate) * FPS));
  }
  if (p.transition === "fade" && p.segments.length > 1) frames -= TRANSITION_FRAMES * (p.segments.length - 1);
  if (p.brand.outro.enabled) frames += Math.round(p.brand.outro.seconds * FPS);
  return Math.max(FPS, frames);
}

export function verseReelFrames(p: VerseReelProps): number {
  const outro = p.brand.outro.enabled ? p.brand.outro.seconds : 0;
  return Math.round((p.hookSeconds + p.verseSeconds + outro) * FPS);
}
