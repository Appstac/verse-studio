// Shared data model for the web app and the worker.
// Everything lives in the user's Google Drive under one "Verse Studio" folder:
//   settings.json            -> Settings
//   Jobs/<id>.json           -> Job
//   Output/<date>/<id>/...   -> rendered files
//   Uploads/, Music/Library/<mood>/, Music/Mine/, Brand/, Backgrounds/, State/
import { z } from "zod";

export const ROOT_FOLDER_NAME = "Verse Studio";
export const APP_MARKER = "verse-studio";

export const PRESETS = ["dawn", "night", "paper", "minimal", "garden", "photo", "footage"] as const;
// Looks that need a photo or video behind the text (verse reels only).
export const MEDIA_PRESETS: readonly string[] = ["photo", "footage"];
export const Preset = z.enum(PRESETS);
export type Preset = z.infer<typeof Preset>;

export const MOODS = ["calm", "uplifting", "worship", "reflective", "christmas", "easter"] as const;
export const Mood = z.enum(MOODS);
export type Mood = z.infer<typeof Mood>;

export const AUDIO_VARIANTS = ["original", "library", "mine", "silent"] as const;
export const AudioVariant = z.enum(AUDIO_VARIANTS);
export type AudioVariant = z.infer<typeof AudioVariant>;

export const Language = z.enum(["english", "telugu", "mixed"]);
export type Language = z.infer<typeof Language>;

export const WatermarkPosition = z.enum(["bottom-center", "bottom-left", "bottom-right", "top-left", "top-center", "top-right"]);
export const TEXT_FONTS = ["clean", "bold", "elegant", "classic", "handwritten"] as const;
export const TextFont = z.enum(TEXT_FONTS);
export type TextFont = z.infer<typeof TextFont>;
export const WatermarkStyle = z.enum(["plain", "shadow", "pill", "outline"]);

export const CAPTION_STYLES = ["pop", "karaoke", "lines", "lyrics", "none"] as const;
export const CaptionLook = z.object({
  font: TextFont.default("clean"),
  color: z.string().default("#ffffff"),
  // Highlight for key words; empty = the brand highlight colour.
  highlight: z.string().default(""),
  size: z.enum(["small", "medium", "large"]).default("medium"),
  position: z.enum(["upper", "middle", "lower"]).default("lower"),
  background: z.enum(["none", "shadow", "box"]).default("shadow"),
  uppercase: z.boolean().default(false),
});
export type CaptionLook = z.infer<typeof CaptionLook>;

// Vertical for Instagram/TikTok/Shorts, horizontal for YouTube.
export const FORMATS = ["reel", "youtube"] as const;
export const VideoFormat = z.enum(FORMATS);
export type VideoFormat = z.infer<typeof VideoFormat>;
export const FORMAT_LABEL: Record<VideoFormat, string> = { reel: "Reel (vertical 9:16)", youtube: "YouTube (horizontal 16:9)" };

// Virtual green screen: put the person on a new background.
export const BG_MODES = ["none", "blur", "studio", "stock", "mine", "color"] as const;
export const BackgroundChoice = z.object({
  mode: z.enum(BG_MODES).default("none"),
  // studio: a built-in backdrop id like "beams-royal" (see shared/backdrops.ts)
  preset: z.string().default("beams-royal"),
  // stock: a Pixabay photo or video picked in the browser
  stockId: z.number().int().optional(),
  stockKind: z.enum(["photo", "video"]).default("photo"),
  stockThumb: z.string().optional(),
  // Soft camera-style blur on photo/video backgrounds so they read as "behind" the speaker.
  depthBlur: z.boolean().default(true),
  // mine: a file from the Backgrounds folder
  mineFileId: z.string().optional(),
  mineName: z.string().optional(),
  color: z.string().default("#1b2a6b"),
});
export type BackgroundChoice = z.infer<typeof BackgroundChoice>;

export const EDIT_TYPES = ["auto", "worship", "talking", "sermon", "montage"] as const;
export type EditType = (typeof EDIT_TYPES)[number];
// Professional = broadcast-style finish (no sound effects, clean subtitles, elegant titles, dissolves).
// Creator = energetic social style (pop-up words, punch zooms, whooshes) for when that's wanted.
export const EDIT_STYLES = ["professional", "creator"] as const;
export const EditStyle = z.enum(EDIT_STYLES);
export type EditStyle = z.infer<typeof EditStyle>;

export const QUALITIES = ["standard", "high", "ultra"] as const;
export const Quality = z.enum(QUALITIES);
export const QUALITY_LABEL: Record<(typeof QUALITIES)[number], string> = {
  standard: "Standard (fastest)",
  high: "High (1080p, best for Instagram)",
  ultra: "Ultra HD 4K (YouTube, slowest)",
};

export const EditDefaults = z.object({
      layout: z.enum(["fill", "blur-pad", "auto"]).default("auto"),
      defaultSeconds: z.number().min(5).max(3600).default(30),
      format: VideoFormat.default("reel"),
      youtubeSeconds: z.number().min(30).max(3600).default(480),
      fullLength: z.boolean().default(false),
      editType: z.enum(EDIT_TYPES).default("auto"),
      editStyle: EditStyle.default("professional"),
      quality: Quality.default("high"),
      relight: z.boolean().default(true),
      background: BackgroundChoice.prefault({}),
      stabilize: z.enum(["auto", "on", "off"]).default("auto"),
      cleanAudio: z.boolean().default(true),
      autoColor: z.boolean().default(true),
      qualityCheck: z.boolean().default(false),
      captions: z.boolean().default(true),
      captionLanguage: z.enum(["auto", "en", "te"]).default("auto"),
      keepOriginalAudio: z.boolean().default(true),
      hookOptions: z.number().int().min(1).max(3).default(1),
      extraLengths: z.array(z.number().min(6).max(3600)).max(3).default([]),
      alsoCarousel: z.boolean().default(false),
});
export type EditDefaults = z.infer<typeof EditDefaults>;

export const Settings = z.object({
  version: z.number().default(1),
  brand: z
    .object({
      handle: z.string().default("@tanishka.guduru"),
      signatureText: z.string().default("@tanishka.guduru"),
      logoFileId: z.string().optional(),
      watermarkPosition: WatermarkPosition.default("bottom-center"),
      watermarkOpacity: z.number().min(0).max(1).default(0.85),
      accentColor: z.string().default("#F4C77B"),
      watermarkEnabled: z.boolean().default(true),
      watermarkFont: TextFont.default("clean"),
      watermarkSize: z.number().min(16).max(96).default(32),
      watermarkStyle: WatermarkStyle.default("shadow"),
      watermarkColor: z.string().default("#ffffff"),
      watermarkShowLogo: z.boolean().default(true),
      outro: z
        .object({
          enabled: z.boolean().default(true),
          // Big line on the end card; empty = the Instagram handle.
          title: z.string().default(""),
          text: z.string().default("Follow for daily encouragement"),
          seconds: z.number().min(0).max(6).default(2),
          showLogo: z.boolean().default(true),
          // Let Claude write a closing line that fits each video instead of the fixed text.
          claudeWrites: z.boolean().default(false),
        })
        .prefault({}),
    })
    .prefault({}),
  auto: z
    .object({
      enabled: z.boolean().default(false),
      reelsPerDay: z.number().int().min(0).max(20).default(2),
      // Auto-made verse videos: vertical, horizontal or both of each.
      format: z.enum(["reel", "youtube", "both"]).default("reel"),
      quality: Quality.default("high"),
      carouselsPerWeek: z.number().int().min(0).max(7).default(1),
      runAt: z.string().regex(/^\d{2}:\d{2}$/).default("05:30"),
      timezone: z.string().default("America/Chicago"),
      themes: z
        .array(z.string())
        .default([
          "Trusting God while waiting",
          "God's peace in anxiety",
          "Healing a broken heart",
          "Strength in weakness",
          "Letting go and surrender",
          "God fights for you",
          "Worship and gratitude",
        ]),
      teluguPercent: z.number().int().min(0).max(100).default(30),
      presets: z.array(Preset).default(["dawn", "night", "paper", "garden", "minimal"]),
      translation: z.enum(["web", "kjv", "bbe", "asv"]).default("web"),
      approval: z.enum(["auto", "review"]).default("auto"),
      avoidRepeatDays: z.number().int().min(0).max(3650).default(120),
      extraInstructions: z.string().default(""),
      seasonal: z.boolean().default(true),
    })
    .prefault({}),
  music: z
    .object({
      variants: z
        .object({
          original: z.boolean().default(true),
          library: z.boolean().default(true),
          mine: z.boolean().default(true),
          silent: z.boolean().default(true),
        })
        .prefault({}),
      musicUnderVoice: z.number().min(0).max(1).default(0.18),
      musicVolume: z.number().min(0).max(1).default(0.9),
      fadeSeconds: z.number().min(0).max(5).default(1.5),
    })
    .prefault({}),
  captions: z
    .object({
      hashtagCount: z.number().int().min(0).max(5).default(5),
      alwaysHashtags: z.array(z.string()).default(["#jesuschrist", "#faith"]),
      cta: z.string().default("Type AMEN if this is for you"),
      tone: z.string().default("warm, gentle, encouraging, sincere, never preachy"),
      onVideoStyle: z.enum(CAPTION_STYLES).default("lines"),
      soundEffects: z.boolean().default(false),
      // How on-video text (captions, lyrics, hook, title card) looks. Editable per video too.
      look: CaptionLook.prefault({}),
    })
    .prefault({}),
  reel: z
    .object({
      minSeconds: z.number().min(5).max(60).default(9),
      maxSeconds: z.number().min(6).max(90).default(18),
      showHook: z.boolean().default(true),
    })
    .prefault({}),
  // Defaults for Make → Edit. The form opens with these; everything can still be changed per video.
  edit: EditDefaults.prefault({}),
  // Saved bundles of every edit choice (built-in ones live in code, see BUILTIN_STYLES).
  stylePresets: z.array(z.lazy(() => StylePreset)).default([]),
  defaultStyleId: z.string().default("sermon-clip-reel"),
  advanced: z
    .object({
      whisperModel: z.enum(["base", "small", "medium", "large-v3-turbo"]).default("small"),
      claudeModel: z.string().default(""),
      pollSeconds: z.number().int().min(10).max(600).default(20),
      // Free key from pixabay.com/api/docs: stock backgrounds and footage (website search + studio computer).
      pixabayKey: z.string().default(""),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof Settings>;
export const defaultSettings = (): Settings => Settings.parse({});

// Watermark and end card as used for one video. Pre-filled from Settings, editable per video.
export const Branding = z.object({
  watermark: z.object({
    enabled: z.boolean(),
    text: z.string(),
    font: TextFont,
    size: z.number().min(16).max(96),
    position: WatermarkPosition,
    opacity: z.number().min(0).max(1),
    style: WatermarkStyle,
    color: z.string(),
    showLogo: z.boolean(),
  }),
  endCard: z.object({
    enabled: z.boolean(),
    title: z.string(),
    text: z.string(),
    seconds: z.number().min(0).max(6),
    showLogo: z.boolean(),
    claudeWrites: z.boolean(),
  }),
});
export type Branding = z.infer<typeof Branding>;

export function brandingFromSettings(s: Settings): Branding {
  const b = s.brand;
  return {
    watermark: {
      enabled: b.watermarkEnabled,
      text: b.signatureText,
      font: b.watermarkFont,
      size: b.watermarkSize,
      position: b.watermarkPosition,
      opacity: b.watermarkOpacity,
      style: b.watermarkStyle,
      color: b.watermarkColor,
      showLogo: b.watermarkShowLogo,
    },
    endCard: {
      enabled: b.outro.enabled,
      title: b.outro.title || b.handle,
      text: b.outro.text,
      seconds: b.outro.seconds,
      showLogo: b.outro.showLogo,
      claudeWrites: b.outro.claudeWrites,
    },
  };
}

// One-tap starting points for the watermark; every field stays editable afterwards.
export const WATERMARK_PRESETS: Array<{ id: string; label: string; patch: Partial<Branding["watermark"]> }> = [
  { id: "subtle", label: "Subtle", patch: { font: "clean", size: 28, style: "shadow", opacity: 0.7, position: "bottom-center", color: "#ffffff" } },
  { id: "signature", label: "Handwritten", patch: { font: "handwritten", size: 48, style: "shadow", opacity: 0.9, position: "bottom-right", color: "#ffffff" } },
  { id: "badge", label: "Badge", patch: { font: "bold", size: 26, style: "pill", opacity: 0.95, position: "top-left", color: "#ffffff" } },
  { id: "elegant", label: "Elegant", patch: { font: "elegant", size: 36, style: "shadow", opacity: 0.85, position: "bottom-center", color: "#F4C77B" } },
  { id: "bold", label: "Bold", patch: { font: "bold", size: 38, style: "outline", opacity: 1, position: "top-center", color: "#ffffff" } },
];

export const CAPTION_PRESETS: Array<{ id: string; label: string; style: (typeof CAPTION_STYLES)[number]; look: Partial<CaptionLook> }> = [
  { id: "pop", label: "Big pop-up words", style: "pop", look: { font: "bold", size: "large", position: "middle", background: "shadow", uppercase: false } },
  { id: "karaoke", label: "Karaoke highlight", style: "karaoke", look: { font: "bold", size: "medium", position: "lower", background: "shadow", uppercase: true } },
  { id: "lyrics", label: "Worship lyrics", style: "lyrics", look: { font: "elegant", size: "medium", position: "lower", background: "shadow", uppercase: false } },
  { id: "boxed", label: "Boxed lines", style: "lines", look: { font: "clean", size: "medium", position: "lower", background: "box", uppercase: false } },
  { id: "handwritten", label: "Handwritten", style: "lines", look: { font: "handwritten", size: "large", position: "middle", background: "shadow", uppercase: false } },
];

export const CaptionChoice = z.object({ style: z.enum(CAPTION_STYLES), look: CaptionLook });
export type CaptionChoice = z.infer<typeof CaptionChoice>;
export function captionChoiceFromSettings(s: Settings): CaptionChoice {
  return { style: s.captions.onVideoStyle, look: s.captions.look };
}

// A saved style: every edit choice in one bundle. Branding/text style left out = use Settings.
export const StylePreset = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  edit: EditDefaults,
  captionChoice: CaptionChoice.optional(),
  branding: Branding.optional(),
});
export type StylePreset = z.infer<typeof StylePreset>;

const ed = (p: Partial<EditDefaults>): EditDefaults => EditDefaults.parse(p);
const look = (p: Partial<CaptionLook>): CaptionLook => CaptionLook.parse(p);
export const BUILTIN_STYLES: StylePreset[] = [
  {
    id: "sermon-clip-reel",
    name: "Sermon clip · Reel",
    description: "The strongest 30-45 s of a message, studio-lit, clean subtitles.",
    edit: ed({ format: "reel", editType: "sermon", defaultSeconds: 40, relight: true, background: BackgroundChoice.parse({ mode: "none" }) }),
    captionChoice: { style: "lines", look: look({ font: "clean", position: "lower", background: "shadow", size: "medium" }) },
  },
  {
    id: "sermon-youtube",
    name: "Full sermon · YouTube",
    description: "Whole message in order, dead air removed, 4K studio finish.",
    edit: ed({ format: "youtube", editType: "sermon", fullLength: true, youtubeSeconds: 1800, quality: "ultra", relight: true }),
    captionChoice: { style: "lines", look: look({ font: "clean", position: "lower", background: "box", size: "small" }) },
  },
  {
    id: "sermon-studio-youtube",
    name: "Studio sermon · YouTube",
    description: "Speaker on a real studio photo background, key and rim light, 8-10 min highlight.",
    edit: ed({ format: "youtube", editType: "sermon", youtubeSeconds: 540, quality: "ultra", relight: true, background: BackgroundChoice.parse({ mode: "stock", stockKind: "photo", depthBlur: true }) }),
    captionChoice: { style: "lines", look: look({ font: "clean", position: "lower", background: "shadow", size: "small" }) },
  },
  {
    id: "worship-reel",
    name: "Worship song · Reel",
    description: "Peak of the song, continuous sound, elegant lyric lines, gentle moves.",
    edit: ed({ format: "reel", editType: "worship", defaultSeconds: 35, relight: false }),
    captionChoice: { style: "lyrics", look: look({ font: "elegant", position: "lower", background: "shadow" }) },
  },
  {
    id: "worship-youtube",
    name: "Worship song · YouTube",
    description: "Full song, horizontal, lyric lines, no music added on top.",
    edit: ed({ format: "youtube", editType: "worship", fullLength: true, youtubeSeconds: 420, quality: "ultra", relight: false }),
    captionChoice: { style: "lyrics", look: look({ font: "elegant", position: "lower", background: "shadow" }) },
  },
  {
    id: "testimony-reel",
    name: "Testimony · Reel",
    description: "Personal story, best takes, soft background blur, warm studio light.",
    edit: ed({ format: "reel", editType: "talking", defaultSeconds: 45, relight: true, background: BackgroundChoice.parse({ mode: "blur" }) }),
    captionChoice: { style: "karaoke", look: look({ font: "clean", position: "lower", background: "shadow" }) },
  },
  {
    id: "devotional-studio",
    name: "Devotional talk · studio backdrop",
    description: "Short devotional on a candle-lit worship backdrop with studio lighting.",
    edit: ed({ format: "reel", editType: "talking", defaultSeconds: 40, relight: true, background: BackgroundChoice.parse({ mode: "studio", preset: "candles-gold" }) }),
    captionChoice: { style: "lines", look: look({ font: "elegant", position: "lower", background: "shadow" }) },
  },
  {
    id: "event-recap",
    name: "Church event recap · Reel",
    description: "Best moments first, varied shots, warm natural colour.",
    edit: ed({ format: "reel", editType: "montage", defaultSeconds: 30, relight: false, captions: false }),
  },
  {
    id: "creator-energetic",
    name: "Creator energetic · Reel",
    description: "Fast social style: pop-up words, punch-ins, sound effects.",
    edit: ed({ format: "reel", editType: "talking", editStyle: "creator", defaultSeconds: 30, relight: true }),
    captionChoice: { style: "pop", look: look({ font: "bold", position: "middle", size: "large" }) },
  },
];

export function allStyles(s: Settings): StylePreset[] {
  return [...BUILTIN_STYLES, ...s.stylePresets];
}

export const VerseRequest = z.object({
  type: z.literal("verse"),
  format: VideoFormat.default("reel"),
  // Also make a horizontal (or vertical) copy of every verse video.
  bothFormats: z.boolean().default(false),
  quality: Quality.default("high"),
  count: z.number().int().min(1).max(20).default(1),
  theme: z.string().default(""),
  language: Language.default("english"),
  preset: z.union([Preset, z.literal("auto")]).default("auto"),
  references: z.array(z.string()).default([]),
  instructions: z.string().default(""),
});
export const EditRequest = z.object({
  type: z.literal("edit"),
  inputFileIds: z.array(z.string()).min(1),
  inputNames: z.array(z.string()).default([]),
  prompt: z.string().default(""),
  targetSeconds: z.number().min(5).max(3600).default(30),
  format: VideoFormat.default("reel"),
  // YouTube sermons: keep the whole message in order, only tidy dead air (no highlight cutting).
  fullLength: z.boolean().default(false),
  layout: z.enum(["fill", "blur-pad", "auto"]).default("auto"),
  captions: z.boolean().default(true),
  captionLanguage: z.enum(["auto", "en", "te"]).default("auto"),
  keepOriginalAudio: z.boolean().default(true),
  alsoCarousel: z.boolean().default(false),
  // What kind of footage this is; each has its own editing recipe.
  editType: z.enum(EDIT_TYPES).default("auto"),
  // Song mode: pasted lyrics are shown line by line instead of speech-recognition captions.
  lyrics: z.string().max(6000).default(""),
  songTitle: z.string().max(120).default(""),
  singer: z.string().max(120).default(""),
  // Who to keep in frame, e.g. "the woman in beige singing at the podium".
  focus: z.string().max(200).default(""),
  stabilize: z.enum(["auto", "on", "off"]).default("auto"),
  cleanAudio: z.boolean().default(true),
  autoColor: z.boolean().default(true),
  // Claude watches the finished reel and fixes problems once before delivering.
  qualityCheck: z.boolean().default(false),
  quality: Quality.default("high"),
  editStyle: EditStyle.default("professional"),
  // Studio key + rim light on the speaker, colour-matched to the backdrop.
  relight: z.boolean().default(true),
  // Parts of each clip to use (set by trimming in the browser). Missing = whole clip.
  ranges: z.array(z.object({ index: z.number().int(), start: z.number().min(0), end: z.number().min(0) })).default([]),
  // Extra lengths to cut from the same upload, e.g. [15, 60] next to targetSeconds.
  extraLengths: z.array(z.number().min(6).max(3600)).max(3).default([]),
  // How many different opening hooks to make (each is a separate version).
  hookOptions: z.number().int().min(1).max(3).default(1),
  branding: Branding.optional(),
  captionChoice: CaptionChoice.optional(),
  background: BackgroundChoice.prefault({}),
});
export const CarouselRequest = z.object({
  type: z.literal("carousel"),
  topic: z.string().default(""),
  slides: z.number().int().min(2).max(10).default(5),
  language: Language.default("english"),
  preset: z.union([Preset, z.literal("auto")]).default("auto"),
});
// Changes to an existing output. Direct fields are applied as-is (fast, no AI);
// "instruction" is a plain-language change that Claude applies.
export const ReviseChanges = z.object({
  hook: z.string().optional(),
  verseText: z.string().optional(),
  reference: z.string().optional(),
  preset: Preset.optional(),
  speed: z.enum(["slower", "normal", "faster"]).optional(),
  caption: z.string().optional(),
  captions: z.enum(["on", "off"]).optional(),
  layout: z.enum(["fill", "blur-pad"]).optional(),
  slides: z.array(z.object({ title: z.string(), body: z.string() })).optional(),
  branding: Branding.optional(),
  captionChoice: CaptionChoice.optional(),
});
export type ReviseChanges = z.infer<typeof ReviseChanges>;
export const ReviseRequest = z.object({
  type: z.literal("revise"),
  sourceJobId: z.string(),
  sourceTitle: z.string().default(""),
  specFileId: z.string(),
  changes: ReviseChanges.default({}),
  instruction: z.string().default(""),
  remember: z.boolean().default(false),
});
export const LearnRequest = z.object({ type: z.literal("learn") });
export const JobRequest = z.discriminatedUnion("type", [VerseRequest, EditRequest, CarouselRequest, ReviseRequest, LearnRequest]);
export type JobRequest = z.infer<typeof JobRequest>;

export const JobStatus = z.enum(["queued", "working", "review", "done", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const OutputVariant = z.object({ label: AudioVariant, fileId: z.string(), name: z.string() });
export const OutputItem = z.object({
  kind: z.enum(["reel", "carousel"]),
  format: VideoFormat.optional(),
  title: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  reference: z.string().optional(),
  needsReview: z.boolean().default(false),
  reviewNote: z.string().optional(),
  variants: z.array(OutputVariant).default([]),
  coverFileId: z.string().optional(),
  slideFileIds: z.array(z.string()).default([]),
  folderId: z.string().optional(),
  specFileId: z.string().optional(),
  source: z.enum(["verse", "edit", "carousel"]).optional(),
  version: z.number().int().default(1),
  revisionOf: z.string().optional(),
  changeNote: z.string().optional(),
});
export type OutputItem = z.infer<typeof OutputItem>;

export const Job = z.object({
  id: z.string(),
  status: JobStatus,
  source: z.enum(["manual", "auto"]).default("manual"),
  createdAt: z.string(),
  updatedAt: z.string(),
  request: JobRequest,
  stage: z.string().default(""),
  progress: z.number().min(0).max(1).default(0),
  outputs: z.array(OutputItem).default([]),
  error: z.string().optional(),
  log: z.array(z.string()).default([]),
  workerId: z.string().optional(),
  approved: z.boolean().optional(),
  attempts: z.number().int().default(0),
});
export type Job = z.infer<typeof Job>;

export const Heartbeat = z.object({
  workerId: z.string(),
  hostname: z.string(),
  platform: z.string(),
  version: z.string(),
  lastSeen: z.string(),
  busy: z.boolean(),
  currentJob: z.string().optional(),
  claudeOk: z.boolean().optional(),
  nextAutoRun: z.string().optional(),
  message: z.string().optional(),
  // Added for the always-on service. All optional so older workers still parse.
  paused: z.boolean().optional(),
  autostart: z.boolean().optional(),
  supervisor: z.enum(["windows", "launchd", "manual"]).optional(),
  startedAt: z.string().optional(),
  commit: z.string().optional(),
  lastError: z.string().optional(),
  lastUpdate: z.object({ at: z.string(), ok: z.boolean(), message: z.string() }).optional(),
  controlAt: z.string().optional(),
  intervalSeconds: z.number().optional(),
});
export type Heartbeat = z.infer<typeof Heartbeat>;

// Written by the website to State/control.json; the worker applies a request once
// (newer requestedAt than the last one it applied) and reports the result in its heartbeat.
export const WorkerControl = z.object({
  requestedAt: z.string(),
  paused: z.boolean().optional(),
  autostart: z.boolean().optional(),
  action: z.enum(["restart", "update"]).optional(),
});
export type WorkerControl = z.infer<typeof WorkerControl>;

export function newJobId(now = new Date()): string {
  const d = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${d}-${Math.random().toString(36).slice(2, 7)}`;
}

export const SUBFOLDERS = [
  "Jobs",
  "Uploads",
  "Output",
  "Music",
  "Music/Library",
  "Music/Mine",
  "Brand",
  "Backgrounds",
  "State",
  "Feedback",
] as const;

// One file per rating in Feedback/ (written by the website, never edited by
// the worker, so there are no write races).
export const FEEDBACK_TAGS = {
  good: ["Great hook", "Love the look", "Good pacing", "Caption is spot on", "Good verse choice", "Good cuts", "Captions look great"],
  bad: ["Hook is weak", "Too slow", "Too fast", "Text too small", "Hard to read", "Wrong verse for the theme", "Caption too long", "Bad cut", "Music doesn't fit", "Captions wrong"],
} as const;
export const Feedback = z.object({
  id: z.string(),
  createdAt: z.string(),
  jobId: z.string(),
  outputKey: z.string(),
  title: z.string(),
  source: z.enum(["verse", "edit", "carousel"]).optional(),
  preset: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).default([]),
  note: z.string().default(""),
  remember: z.boolean().default(true),
});
export type Feedback = z.infer<typeof Feedback>;

export const LEARNED_FILE = "Learned style.md";
export const outputKey = (jobId: string, o: { coverFileId?: string; title: string }) => `${jobId}:${o.coverFileId ?? o.title}`;
