// Shared data model for the web app and the worker.
// Everything lives in the user's Google Drive under one "Verse Studio" folder:
//   settings.json            -> Settings
//   Jobs/<id>.json           -> Job
//   Output/<date>/<id>/...   -> rendered files
//   Uploads/, Music/Library/<mood>/, Music/Mine/, Brand/, Backgrounds/, State/
import { z } from "zod";

export const ROOT_FOLDER_NAME = "Verse Studio";
export const APP_MARKER = "verse-studio";

export const PRESETS = ["dawn", "night", "paper", "minimal", "garden", "photo"] as const;
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

export const WatermarkPosition = z.enum(["bottom-center", "bottom-left", "top-left", "top-center", "top-right"]);

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
      outro: z
        .object({
          enabled: z.boolean().default(true),
          text: z.string().default("Follow for daily encouragement"),
          seconds: z.number().min(0).max(5).default(2),
        })
        .prefault({}),
    })
    .prefault({}),
  auto: z
    .object({
      enabled: z.boolean().default(false),
      reelsPerDay: z.number().int().min(0).max(20).default(2),
      carouselsPerWeek: z.number().int().min(0).max(14).default(1),
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
      onVideoStyle: z.enum(["karaoke", "lines", "none"]).default("karaoke"),
    })
    .prefault({}),
  reel: z
    .object({
      minSeconds: z.number().min(5).max(60).default(9),
      maxSeconds: z.number().min(6).max(90).default(18),
      showHook: z.boolean().default(true),
    })
    .prefault({}),
  edit: z
    .object({
      layout: z.enum(["fill", "blur-pad"]).default("blur-pad"),
      defaultSeconds: z.number().min(5).max(90).default(30),
    })
    .prefault({}),
  advanced: z
    .object({
      whisperModel: z.enum(["base", "small", "medium", "large-v3-turbo"]).default("small"),
      claudeModel: z.string().default(""),
      pollSeconds: z.number().int().min(10).max(600).default(20),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof Settings>;
export const defaultSettings = (): Settings => Settings.parse({});

export const VerseRequest = z.object({
  type: z.literal("verse"),
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
  targetSeconds: z.number().min(5).max(90).default(30),
  layout: z.enum(["fill", "blur-pad", "auto"]).default("auto"),
  captions: z.boolean().default(true),
  captionLanguage: z.enum(["auto", "en", "te"]).default("auto"),
  keepOriginalAudio: z.boolean().default(true),
});
export const CarouselRequest = z.object({
  type: z.literal("carousel"),
  topic: z.string().default(""),
  slides: z.number().int().min(2).max(10).default(5),
  language: Language.default("english"),
  preset: z.union([Preset, z.literal("auto")]).default("auto"),
});
export const JobRequest = z.discriminatedUnion("type", [VerseRequest, EditRequest, CarouselRequest]);
export type JobRequest = z.infer<typeof JobRequest>;

export const JobStatus = z.enum(["queued", "working", "review", "done", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const OutputVariant = z.object({ label: AudioVariant, fileId: z.string(), name: z.string() });
export const OutputItem = z.object({
  kind: z.enum(["reel", "carousel"]),
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
});
export type Heartbeat = z.infer<typeof Heartbeat>;

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
] as const;
