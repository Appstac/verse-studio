// Props passed from the worker into the Remotion compositions.
// Kept free of zod so the Remotion bundle stays small.

export type PresetName = "dawn" | "night" | "paper" | "minimal" | "garden" | "photo" | "footage";
export type Lang = "english" | "telugu";

export type TextFontName = "clean" | "bold" | "elegant" | "classic" | "handwritten";

export type BrandProps = {
  signatureText: string;
  logoSrc?: string;
  position: "bottom-center" | "bottom-left" | "bottom-right" | "top-left" | "top-center" | "top-right";
  opacity: number;
  accent: string;
  outro: { enabled: boolean; text: string; seconds: number; title?: string; showLogo?: boolean };
  handle: string;
  // Watermark look. Missing = the original look (Inter, 32px, shadow, logo shown).
  watermark?: {
    enabled: boolean;
    font: TextFontName;
    size: number;
    style: "plain" | "shadow" | "pill" | "outline";
    color: string;
    showLogo: boolean;
  };
}

export type CaptionLookProps = {
  font: TextFontName;
  color: string;
  highlight: string;
  size: "small" | "medium" | "large";
  position: "upper" | "middle" | "lower";
  background: "none" | "shadow" | "box";
  uppercase: boolean;
}

// A light colour correction applied in the browser while rendering.
export type Grade = {
  exposure: number; // -1..1
  contrast: number; // -1..1
  highlights: number; // 0..1, how much to pull down blown-out areas
  saturation: number; // -1..1
  warmth: number; // -1..1
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
  zoom: "none" | "in" | "out" | "punch" | "pan";
  layout: "fill" | "blur-pad";
  textOverlay?: string;
  // Reframing: the point to keep centred (0-1 of the source frame) and how tight to crop.
  focusX?: number;
  focusY?: number;
  focusEndX?: number;
  focusEndY?: number;
  crop?: number; // 1 = just fill the frame, up to 1.8
  grade?: number; // index into ClipEditProps.grades
  audioFadeIn?: number; // frames
  audioFadeOut?: number; // frames
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
  captions: {
    words: CaptionWord[];
    style: "pop" | "karaoke" | "lines" | "lyrics" | "none";
    language: Lang;
    emphasis?: string[];
    look?: CaptionLookProps;
  };
  // Song lyrics, one line at a time, on the output timeline.
  lyrics?: Array<{ text: string; startMs: number; endMs: number }>;
  titleCard?: { title: string; subtitle?: string };
  grades?: Grade[];
  // One continuous sound source under all the pictures (songs): pictures can cut freely.
  audioBed?: { src: string; start: number; fadeOutFrames: number };
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
