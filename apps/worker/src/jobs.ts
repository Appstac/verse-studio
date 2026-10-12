import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import {
  type Effects,
  type Branding,
  type ClipAnalysis,
  analysisKey,
  type CaptionChoice,
  type Job,
  type OutputItem,
  type ReviseChanges,
  type Settings,
  MEDIA_PRESETS,
  PRESETS,
  brandingFromSettings,
} from "../../../shared/schema";
import { findFootage, footageById, photoById, pixabayEnabled } from "./pixabay";
import { type BackgroundSource, finishSubject, makeMatte, mattingAvailable } from "./matting";
import { backdropById } from "../../../shared/backdrops";
import { FPS, TRANSITION_FRAMES, type BrandProps, type CaptionWord, type ClipEditProps, type ClipSegment, type PresetName, type VerseReelProps } from "../remotion/types";
import { TRANSLATION_LABEL } from "./bible";
import { mount, startFileServer, unmount } from "./fileserver";
import { log } from "./log";
import {
  type PictureStats,
  audioMap,
  contactSheet,
  describeAudioMap,
  frameSheets,
  pictureStats,
  extractWav,
  makeSfx,
  ffmpeg,
  isImageName,
  makeVariant,
  normalizeVideo,
  probe,
  safeName,
  type MixMode,
} from "./media";
import {
  CarouselPlan,
  EditPlan,
  EditReview,
  VersePlan,
  VerseRevision,
  carouselFromVideoPrompt,
  carouselPrompt,
  carouselRevisionPrompt,
  editPrompt,
  editReviewPrompt,
  editRevisionPrompt,
  versePrompt,
  verseRevisionPrompt,
  type VerseItem,
} from "./plans";
import { renderBackdrop, renderClipEdit, renderCover, renderSlide, renderVerseReel } from "./render";
import { sub } from "./paths";
import type { MusicFile, Store } from "./store";
import type { Transcript } from "./whisper";

export interface Planner {
  plan<T>(kind: string, prompt: string, schema: z.ZodType<T>, opts: { cwd: string; allowRead?: boolean; model?: string }): Promise<T>;
  verse(reference: string, translation: string): Promise<{ text: string; reference: string }>;
  transcribe(wav: string, model: Settings["advanced"]["whisperModel"], lang: "auto" | "en" | "te"): Promise<Transcript>;
}

export class Cancelled extends Error {}

export interface Ctx {
  store: Store;
  settings: Settings;
  job: Job;
  fileId: string;
  work: string;
  ai: Planner;
  update(p: Partial<Job>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Specs: everything needed to re-render an output later with changes. Saved
// next to each output in Drive, so quick changes work even after a restart.

// Per-output look overrides (watermark, end card, caption style). Missing = Settings.
interface SpecLook {
  branding?: Branding;
  captionChoice?: CaptionChoice;
}

export interface VerseSpec extends SpecLook {
  source: "verse";
  format?: "reel" | "youtube";
  quality?: "standard" | "high" | "ultra";
  item: VerseItem;
  text: string;
  displayRef: string;
  preset: PresetName;
  backgroundFileId?: string;
  backgroundName?: string;
  pixabayId?: number;
  speed: number; // 1 = normal reveal
  needsReview: boolean;
  reviewNote?: string;
}

export interface ClipRef {
  fileId: string;
  name: string;
  words: CaptionWord[];
  language?: string;
}

export interface EditSpec extends SpecLook {
  source: "edit";
  request: Extract<Job["request"], { type: "edit" }>;
  plan: EditPlan;
  clips: ClipRef[];
  showCaptions: boolean;
  layout?: "fill" | "blur-pad";
}

export interface CarouselSlideSpec {
  kind: "cover" | "body" | "cta";
  title: string;
  body?: string;
  reference?: string;
}

export interface CarouselSpec extends SpecLook {
  source: "carousel";
  plan: CarouselPlan;
  preset: PresetName;
  language: "english" | "telugu";
  slides: CarouselSlideSpec[];
  needsReview: boolean;
}

export type AnySpec = VerseSpec | EditSpec | CarouselSpec;

// ---------------------------------------------------------------------------

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const today = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

function seededPick<T>(arr: T[], seed: number): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.abs(Math.floor(seed)) % arr.length];
}
const seedOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

async function brandProps(ctx: Ctx, url: (f: string) => string, branding?: Branding): Promise<BrandProps> {
  const b = ctx.settings.brand;
  const br = branding ?? brandingFromSettings(ctx.settings);
  let logoSrc: string | undefined;
  if (b.logoFileId) {
    try {
      const f = path.join(ctx.work, "logo.png");
      const p = fs.existsSync(f) ? f : await ctx.store.download(b.logoFileId, f);
      logoSrc = url(p);
    } catch (e) {
      log("Logo download failed, continuing without it:", String(e));
    }
  }
  const wm = br.watermark;
  return {
    signatureText: wm.text,
    handle: b.handle,
    logoSrc,
    position: wm.position,
    opacity: wm.opacity,
    accent: b.accentColor,
    outro: { enabled: br.endCard.enabled, text: br.endCard.text, seconds: br.endCard.seconds, title: br.endCard.title || b.handle, showLogo: br.endCard.showLogo },
    watermark: { enabled: wm.enabled, font: wm.font, size: wm.size, style: wm.style, color: wm.color, showLogo: wm.showLogo },
  };
}

async function pickMusic(ctx: Ctx, kind: "library" | "mine", mood: string, seed: number): Promise<string | undefined> {
  const all: MusicFile[] = await ctx.store.listMusic(kind);
  if (!all.length) return undefined;
  const matching = all.filter((m) => m.mood === mood);
  const choice = seededPick(matching.length ? matching : all, seed)!;
  const ext = path.extname(choice.name) || ".mp3";
  const dest = path.join(ctx.work, "music", `${kind}-${choice.id.replace(/[^\w-]/g, "_")}${ext}`);
  if (!fs.existsSync(dest)) await ctx.store.download(choice.id, dest);
  return dest;
}

interface VariantPlan {
  label: "original" | "library" | "mine" | "silent";
  mode: MixMode;
  music?: string;
}

async function variantPlans(ctx: Ctx, mood: string, seed: number, hasVoice: boolean, noMusicUnderVoice = false): Promise<VariantPlan[]> {
  const v = ctx.settings.music.variants;
  const out: VariantPlan[] = [];
  if (hasVoice && (v.original || noMusicUnderVoice)) out.push({ label: "original", mode: "original" });
  if (hasVoice && noMusicUnderVoice) {
    out.push({ label: "silent", mode: "silent" });
    return out;
  }
  if (v.library) {
    const m = await pickMusic(ctx, "library", mood, seed);
    if (m) out.push({ label: "library", mode: hasVoice ? "music-under-voice" : "music", music: m });
  }
  if (v.mine) {
    const m = await pickMusic(ctx, "mine", mood, seed + 1);
    if (m) out.push({ label: "mine", mode: hasVoice ? "music-under-voice" : "music", music: m });
  }
  if (v.silent || out.length === 0) out.push({ label: "silent", mode: "silent" });
  return out;
}

interface Lineage {
  version?: number;
  revisionOf?: string;
  changeNote?: string;
}

async function deliverReel(
  ctx: Ctx,
  opts: {
    master: string;
    duration: number;
    cover: string;
    slug: string;
    title: string;
    caption: string;
    hashtags: string[];
    mood: string;
    hasVoice: boolean;
    /** Songs: never put library music on top of the singing. */
    noMusicUnderVoice?: boolean;
    format?: "reel" | "youtube";
    folderId: string;
    spec: AnySpec;
    reference?: string;
    needsReview?: boolean;
    reviewNote?: string;
  } & Lineage,
): Promise<OutputItem> {
  const seed = seedOf(opts.slug);
  const plans = await variantPlans(ctx, opts.mood, seed, opts.hasVoice, !!opts.noMusicUnderVoice);
  const variants: OutputItem["variants"] = [];
  for (const p of plans) {
    const local = path.join(ctx.work, `${opts.slug}-${p.label}.mp4`);
    const volume = p.mode === "music-under-voice" ? ctx.settings.music.musicUnderVoice : ctx.settings.music.musicVolume;
    await makeVariant({
      video: opts.master,
      out: local,
      mode: p.mode,
      music: p.music,
      duration: opts.duration,
      musicVolume: volume,
      fade: ctx.settings.music.fadeSeconds,
    });
    const id = await ctx.store.upload(local, opts.folderId);
    variants.push({ label: p.label, fileId: id, name: path.basename(local) });
  }
  const coverId = await ctx.store.upload(opts.cover, opts.folderId, `${opts.slug}-cover.jpg`);
  const tags = normalizeTags(opts.hashtags, ctx.settings);
  const captionFile = path.join(ctx.work, `${opts.slug}-caption.txt`);
  fs.writeFileSync(captionFile, `${opts.caption.trim()}\n\n${tags.join(" ")}\n`);
  await ctx.store.upload(captionFile, opts.folderId);
  const specFileId = await ctx.store.saveSpec({ ...opts.spec, caption: opts.caption.trim(), hashtags: tags, title: opts.title }, opts.folderId, `${opts.slug}-spec.json`);
  return {
    kind: "reel",
    format: opts.format ?? "reel",
    title: opts.title,
    caption: opts.caption.trim(),
    hashtags: tags,
    reference: opts.reference,
    needsReview: !!opts.needsReview,
    reviewNote: opts.reviewNote,
    variants,
    coverFileId: coverId,
    slideFileIds: [],
    folderId: opts.folderId,
    specFileId,
    source: opts.spec.source,
    version: opts.version ?? 1,
    revisionOf: opts.revisionOf,
    changeNote: opts.changeNote,
  };
}

function normalizeTags(tags: string[], s: Settings): string[] {
  const clean = (t: string) => "#" + t.replace(/^#+/, "").replace(/\s+/g, "").toLowerCase();
  const list = [...s.captions.alwaysHashtags, ...tags].map(clean).filter((t) => t.length > 1);
  return [...new Set(list)].slice(0, s.captions.hashtagCount);
}

function wordCount(t: string) {
  return t.split(/\s+/).filter(Boolean).length;
}

// The website asks for a cancel by creating Jobs/<id>.cancel (so it never
// races with the worker writing the job file).
async function checkCancelled(ctx: Ctx) {
  if (await ctx.store.isCancelRequested(ctx.job.id).catch(() => false)) throw new Cancelled("Cancelled");
}

const model = (ctx: Ctx) => ctx.settings.advanced.claudeModel || undefined;

// ---------------------------------------------------------------------------
// Verse reels

export async function runVerseJob(ctx: Ctx) {
  const req = ctx.job.request;
  if (req.type !== "verse") throw new Error("wrong job type");
  const s = ctx.settings;
  await startFileServer();
  const url = mount(ctx.job.id, ctx.work);
  try {
    const history = await ctx.store.readState<{ used: Array<{ ref: string; date: string }> }>("history", { used: [] });
    const cutoff = Date.now() - s.auto.avoidRepeatDays * 86400000;
    const recent = history.used.filter((u) => Date.parse(u.date) > cutoff).map((u) => u.ref);
    const presets = req.preset === "auto" ? (ctx.job.source === "auto" ? s.auto.presets : PRESETS.filter((p) => p !== "photo")) : [req.preset];
    const backgrounds = await ctx.store.listBackgrounds();
    const allowed = [...new Set([...presets, ...(backgrounds.length && req.preset === "auto" ? ["photo"] : [])])].filter(
      (p) => p !== "footage" || pixabayEnabled(),
    );

    await ctx.update({ stage: "Writing hooks, picking verses and captions with Claude", progress: 0.05 });
    const plan = await ctx.ai.plan(
      "verse",
      versePrompt({
        s,
        count: req.count,
        theme: req.theme,
        language: req.language,
        references: req.references,
        instructions: req.instructions,
        presets: allowed,
        recent,
        now: new Date(),
      }),
      VersePlan,
      { cwd: ctx.work, model: model(ctx) },
    );
    const items = plan.items.slice(0, req.count);
    const folderId = await ctx.store.outputFolder(today(s.auto.timezone), ctx.job.id);
    const brand = await brandProps(ctx, url);
    const outputs: OutputItem[] = [];

    for (let i = 0; i < items.length; i++) {
      await checkCancelled(ctx);
      const it = items[i];
      const base = 0.1 + (0.85 * i) / items.length;
      const step = 0.85 / items.length;
      await ctx.update({ stage: `Reel ${i + 1} of ${items.length}: ${it.reference}`, progress: base });
      const spec = await resolveVerse(ctx, it, backgrounds, req.preset === "auto" ? undefined : req.preset, i);
      spec.format = req.format ?? "reel";
      spec.quality = req.quality ?? "high";
      const slug = `${String(i + 1).padStart(2, "0")}-${safeName(it.title || it.reference)}`;
      const formats: Array<"reel" | "youtube"> = req.bothFormats ? [spec.format, spec.format === "reel" ? "youtube" : "reel"] : [spec.format];
      for (const [k, fmt] of formats.entries()) {
        const one = { ...spec, format: fmt };
        const sub = step / formats.length;
        outputs.push(await renderVerseSpec(ctx, one, brand, url, fmt === "youtube" ? `${slug}-youtube` : slug, folderId, base + sub * k, sub, {}));
      }
      history.used.push({ ref: it.reference, date: new Date().toISOString() });
      await ctx.update({ outputs: [...outputs] });
    }
    history.used = history.used.slice(-2000);
    await ctx.store.writeState("history", history);
    return outputs;
  } finally {
    unmount(ctx.job.id);
  }
}

async function resolveVerse(
  ctx: Ctx,
  it: VerseItem,
  backgrounds: Array<{ id: string; name: string }>,
  forcedPreset: PresetName | undefined,
  index: number,
): Promise<VerseSpec> {
  const s = ctx.settings;
  let text = "";
  let displayRef = it.reference;
  let needsReview = false;
  let reviewNote: string | undefined;
  if (it.language === "telugu") {
    text = it.teluguText.trim() || it.textHint.trim();
    displayRef = it.teluguReference.trim() || it.reference;
    needsReview = true;
    reviewNote = "Telugu verse text was written by Claude. Check it against your Telugu Bible before posting.";
  } else {
    try {
      const v = await ctx.ai.verse(it.reference, s.auto.translation);
      text = v.text;
      displayRef = `${v.reference} ${TRANSLATION_LABEL[s.auto.translation] ?? ""}`.trim();
    } catch {
      text = it.textHint.trim();
      needsReview = true;
      reviewNote = "Couldn't reach the Bible text service, so this verse text is from Claude's memory. Check it before posting.";
    }
  }
  let preset = (forcedPreset ?? it.preset) as PresetName;
  let backgroundFileId: string | undefined;
  let backgroundName: string | undefined;
  if (preset === "photo") {
    const pick = seededPick(backgrounds, seedOf(it.reference) + index);
    if (pick) {
      backgroundFileId = pick.id;
      backgroundName = pick.name;
    } else preset = "night";
  }
  let pixabayId: number | undefined;
  if (preset === "footage") {
    const f = pixabayEnabled() ? await findFootage(it.footageQuery || it.mood) : null;
    if (f) pixabayId = f.id;
    else preset = "night";
  }
  return { source: "verse", item: it, text, displayRef, preset, backgroundFileId, backgroundName, pixabayId, speed: 1, needsReview, reviewNote };
}

async function verseProps(ctx: Ctx, spec: VerseSpec, brand: BrandProps, url: (f: string) => string): Promise<VerseReelProps> {
  const s = ctx.settings;
  let background: VerseReelProps["background"];
  let preset = spec.preset;
  if (preset === "photo") {
    if (spec.backgroundFileId && spec.backgroundName) {
      const local = await ctx.store.download(
        spec.backgroundFileId,
        path.join(ctx.work, "bg", `${spec.backgroundFileId.replace(/[^\w-]/g, "_")}${path.extname(spec.backgroundName)}`),
      );
      if (isImageName(spec.backgroundName)) background = { type: "image", src: url(local) };
      else {
        const norm = local.replace(/(\.\w+)$/, "-norm.mp4");
        if (!fs.existsSync(norm)) await normalizeVideo(local, norm);
        const info = await probe(norm);
        background = { type: "video", src: url(norm), durationSeconds: info.duration };
      }
    } else preset = "night";
  }
  if (preset === "footage") {
    const local = spec.pixabayId ? await footageById(spec.pixabayId) : null;
    if (local) {
      const dest = path.join(ctx.work, "bg", `pixabay-${spec.pixabayId}.mp4`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) await normalizeVideo(local, dest);
      const info = await probe(dest);
      background = { type: "video", src: url(dest), durationSeconds: info.duration };
    } else preset = "night";
  }
  const it = spec.item;
  const words = wordCount(spec.text);
  const perWord = it.language === "telugu" ? 0.55 : 0.4;
  const verseSeconds = clamp((words * perWord + 3) * (spec.speed || 1), s.reel.minSeconds - 2, s.reel.maxSeconds * 1.3);
  const hook = s.reel.showHook && it.hook.trim() ? it.hook.trim() : undefined;
  return {
    format: spec.format ?? "reel",
    preset,
    language: it.language,
    hook,
    verseText: spec.text,
    reference: spec.displayRef,
    emphasis: it.emphasis,
    background,
    brand,
    verseSeconds,
    hookSeconds: hook ? 2 : 0,
    seed: seedOf(it.reference),
  };
}

async function renderVerseSpec(
  ctx: Ctx,
  spec: VerseSpec,
  brand: BrandProps,
  url: (f: string) => string,
  slug: string,
  folderId: string,
  base: number,
  step: number,
  lineage: Lineage,
) {
  const props = await verseProps(ctx, spec, brand, url);
  const master = path.join(ctx.work, `${slug}-master.mp4`);
  const duration = await renderVerseReel(
    props,
    master,
    (p) => {
      void ctx.update({ progress: base + step * 0.8 * p }).catch(() => undefined);
    },
    QUALITY[spec.quality ?? "high"],
  );
  const cover = path.join(ctx.work, `${slug}-cover.jpg`);
  await renderCover(props, cover, props.hookSeconds + props.verseSeconds * 0.75);
  await ctx.update({ stage: `${spec.item.title || spec.item.reference}: adding music and uploading`, progress: base + step * 0.85 });
  return deliverReel(ctx, {
    master,
    duration,
    cover,
    slug,
    title: spec.item.title || spec.item.reference,
    caption: spec.item.caption,
    hashtags: spec.item.hashtags,
    mood: spec.item.mood,
    hasVoice: false,
    folderId,
    spec,
    reference: spec.displayRef,
    needsReview: spec.needsReview,
    reviewNote: spec.reviewNote,
    format: spec.format ?? "reel",
    ...lineage,
  });
}

// ---------------------------------------------------------------------------
// Carousels

export async function runCarouselJob(ctx: Ctx) {
  const req = ctx.job.request;
  if (req.type !== "carousel") throw new Error("wrong job type");
  const s = ctx.settings;
  await startFileServer();
  const url = mount(ctx.job.id, ctx.work);
  try {
    const history = await ctx.store.readState<{ used: Array<{ ref: string; date: string }> }>("history", { used: [] });
    await ctx.update({ stage: "Writing the carousel with Claude", progress: 0.1 });
    const presets = req.preset === "auto" ? s.auto.presets.filter((p) => !MEDIA_PRESETS.includes(p)) : [req.preset];
    const plan = await ctx.ai.plan(
      "carousel",
      carouselPrompt({ s, topic: req.topic, slides: req.slides, language: req.language, presets, recent: history.used.map((u) => u.ref) }),
      CarouselPlan,
      { cwd: ctx.work, model: model(ctx) },
    );
    const spec = await resolveCarousel(ctx, plan, presets, req.language === "telugu" ? "telugu" : "english", req.slides, history);
    await ctx.store.writeState("history", { used: history.used.slice(-2000) });
    const folderId = await ctx.store.outputFolder(today(s.auto.timezone), ctx.job.id);
    return [await renderCarouselSpec(ctx, spec, await brandProps(ctx, url), folderId, {})];
  } finally {
    unmount(ctx.job.id);
  }
}

async function resolveCarousel(
  ctx: Ctx,
  plan: CarouselPlan,
  presets: string[],
  language: "english" | "telugu",
  maxSlides: number,
  history: { used: Array<{ ref: string; date: string }> },
): Promise<CarouselSpec> {
  const preset = (presets.includes(plan.preset) ? plan.preset : presets[0] ?? "paper") as PresetName;
  let needsReview = language === "telugu";
  const slides: CarouselSlideSpec[] = [];
  for (const sl of plan.slides.slice(0, maxSlides)) {
    let body = sl.body;
    let reference: string | undefined;
    if (sl.verseRef.trim()) {
      try {
        const v = await ctx.ai.verse(sl.verseRef.trim(), ctx.settings.auto.translation);
        body = `“${v.text}”`;
        reference = v.reference;
        history.used.push({ ref: sl.verseRef.trim(), date: new Date().toISOString() });
      } catch {
        reference = sl.verseRef.trim();
        needsReview = true;
      }
    }
    slides.push({ kind: sl.kind, title: sl.title, body: body || undefined, reference });
  }
  return { source: "carousel", plan, preset, language, slides, needsReview };
}

async function renderCarouselSpec(ctx: Ctx, spec: CarouselSpec, brand: BrandProps, folderId: string, lineage: Lineage): Promise<OutputItem> {
  const slug = safeName(spec.plan.title);
  const ids: string[] = [];
  for (let i = 0; i < spec.slides.length; i++) {
    await checkCancelled(ctx);
    const sl = spec.slides[i];
    await ctx.update({ stage: `Slide ${i + 1} of ${spec.slides.length}`, progress: 0.2 + (0.7 * i) / spec.slides.length });
    const out = path.join(ctx.work, `${slug}-${String(i + 1).padStart(2, "0")}${lineage.version && lineage.version > 1 ? `-v${lineage.version}` : ""}.png`);
    await renderSlide(
      {
        preset: spec.preset,
        language: spec.language,
        kind: sl.kind,
        index: i,
        total: spec.slides.length,
        title: sl.title,
        body: sl.body,
        reference: sl.reference,
        brand,
        seed: seedOf(spec.plan.title),
      },
      out,
    );
    ids.push(await ctx.store.upload(out, folderId));
  }
  const tags = normalizeTags(spec.plan.hashtags, ctx.settings);
  const captionFile = path.join(ctx.work, `${slug}-caption.txt`);
  fs.writeFileSync(captionFile, `${spec.plan.caption.trim()}\n\n${tags.join(" ")}\n`);
  await ctx.store.upload(captionFile, folderId);
  const specFileId = await ctx.store.saveSpec(spec, folderId, `${slug}-spec.json`);
  return {
    kind: "carousel",
    title: spec.plan.title,
    caption: spec.plan.caption.trim(),
    hashtags: tags,
    needsReview: spec.needsReview,
    reviewNote: spec.needsReview ? "Check the Telugu text or scripture wording before posting." : undefined,
    variants: [],
    coverFileId: ids[0],
    slideFileIds: ids,
    folderId,
    specFileId,
    source: "carousel",
    version: lineage.version ?? 1,
    revisionOf: lineage.revisionOf,
    changeNote: lineage.changeNote,
  };
}

// ---------------------------------------------------------------------------
// Video edits

interface PreparedClip {
  index: number;
  fileId: string;
  name: string;
  raw: string;
  /** Start of the part being used in the original file (trim), seconds. */
  offset: number;
  /** Length of the part being used. */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  isImage: boolean;
  sheets: string[];
  sheetStep: number;
  audioDesc: string;
  pictureDesc: string;
  transcript?: Transcript;
  /** Full-quality processed piece for rendering, and where it starts in clip time. */
  file?: string;
  /** Already placed on a virtual set in the output's shape: frame it as-is. */
  onSet?: boolean;
  /** Claude's notes from an earlier viewing (saved in Drive). */
  notes: string;
  transcriptModel?: string;
  fileStart: number;
  fileLength: number;
}

// Phrases with exact start-end times, split wherever she pauses, so Claude can
// cut out pauses and repeated takes precisely.
function transcriptText(t?: Transcript) {
  if (!t || !t.words.length) return "";
  const out: string[] = [];
  let cur: string[] = [];
  let start = 0;
  let end = 0;
  const flush = () => {
    if (cur.length) out.push(`[${(start / 1000).toFixed(2)}-${(end / 1000).toFixed(2)}] ${cur.join(" ")}`);
    cur = [];
  };
  for (const w of t.words) {
    const gap = w.startMs - end;
    if (cur.length && (gap > 350 || cur.length >= 14)) {
      flush();
      if (gap > 350) out.push(`(pause ${(gap / 1000).toFixed(1)}s)`);
      start = w.startMs;
    }
    if (!cur.length) start = w.startMs;
    cur.push(w.text);
    end = w.endMs;
  }
  flush();
  return out.join("\n").slice(0, 12000);
}

function describePicture(p: PictureStats | null) {
  if (!p) return "";
  const notes: string[] = [];
  if (p.brightness < 0.32) notes.push("dark");
  if (p.brightness > 0.62) notes.push("very bright");
  if (p.clippedHighlights > 0.25) notes.push("blown-out highlights");
  if (p.warmth < -0.15) notes.push("cold/blue light");
  if (p.warmth > 0.35) notes.push("very warm/orange");
  if (p.saturation < 0.25) notes.push("washed-out colour");
  return `average brightness ${p.brightness}, highlight clipping ${p.clippedHighlights}, warmth ${p.warmth}, saturation ${p.saturation}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/** Saves (merges) what was learned about one clip to Drive: Analysis/<fileId>.json. */
async function saveAnalysis(ctx: Ctx, clip: PreparedClip, saved: ClipAnalysis | null, notes?: string) {
  const a: ClipAnalysis = saved ?? { fileId: clip.fileId, name: clip.name, parts: {} };
  const key = analysisKey(clip.offset, clip.duration);
  const prev = a.parts[key];
  a.name = clip.name || a.name;
  a.parts[key] = {
    offset: clip.offset,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
    hasAudio: clip.hasAudio,
    transcript: clip.transcript?.words.length
      ? { language: clip.transcript.language, model: clip.transcriptModel ?? prev?.transcript?.model ?? ctx.settings.advanced.whisperModel, words: clip.transcript.words }
      : prev?.transcript,
    audioDesc: clip.audioDesc || prev?.audioDesc || "",
    pictureDesc: clip.pictureDesc || prev?.pictureDesc || "",
    notes: notes ?? prev?.notes ?? "",
    updatedAt: new Date().toISOString(),
  };
  await ctx.store.writeAnalysis(a);
}

/** Keeps a folder under a size limit by removing the least recently used files. */
function pruneCache(dir: string, maxBytes: number) {
  try {
    const files = fs
      .readdirSync(dir)
      .map((n) => {
        const f = path.join(dir, n);
        const st = fs.statSync(f);
        return { f, size: st.size, t: st.atimeMs > st.mtimeMs ? st.atimeMs : st.mtimeMs };
      })
      .sort((a, b) => b.t - a.t);
    let total = 0;
    for (const x of files) {
      total += x.size;
      if (total > maxBytes) fs.rmSync(x.f, { force: true });
    }
  } catch {
    /* ignore */
  }
}

/** Downloads an upload once and keeps it on the studio computer (up to ~25 GB, oldest removed first). */
async function cachedDownload(ctx: Ctx, fileId: string, name: string): Promise<string> {
  const dir = sub("cache", "uploads");
  const dest = path.join(dir, `${fileId.replace(/[^\w-]/g, "_")}${path.extname(name).toLowerCase() || ".mp4"}`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    const now = new Date();
    fs.utimesSync(dest, now, now);
    return dest;
  }
  await ctx.store.download(fileId, `${dest}.part`);
  fs.renameSync(`${dest}.part`, dest);
  pruneCache(dir, 25 * 1024 ** 3);
  return dest;
}

/**
 * Fast analysis of every clip: frame grids from keyframes, picture stats, a loudness
 * map and (in parallel) speech-to-text. No full-quality processing happens here;
 * that is done later only for the parts the edit actually uses.
 */
async function prepareClips(
  ctx: Ctx,
  refs: Array<{ fileId: string; name: string; words?: CaptionWord[]; language?: string }>,
  opts: { captionLanguage: "auto" | "en" | "te"; ranges?: EditSpec["request"]["ranges"]; transcribe: boolean; fastModel: boolean; analyze: boolean },
): Promise<PreparedClip[]> {
  const clips: PreparedClip[] = [];
  for (let i = 0; i < refs.length; i++) {
    await checkCancelled(ctx);
    const { fileId, name } = refs[i];
    await ctx.update({ stage: `Downloading clip ${i + 1} of ${refs.length}: ${name}`, progress: 0.02 + (0.15 * i) / refs.length });
    const raw = intoWork(ctx, await cachedDownload(ctx, fileId, name), `${i}-${safeName(name, 40)}${path.extname(name) || ".mp4"}`);
    const image = isImageName(name);
    const info = image ? null : await probe(raw);
    const clip: PreparedClip = {
      index: i,
      fileId,
      name,
      raw,
      offset: 0,
      duration: image ? 4 : info!.duration,
      width: info?.width ?? 0,
      height: info?.height ?? 0,
      hasAudio: !image && !!info?.hasAudio,
      isImage: image,
      sheets: [],
      sheetStep: 1,
      audioDesc: "",
      pictureDesc: "",
      fileStart: 0,
      fileLength: 0,
      notes: "",
    };
    if (image) {
      const file = path.join(ctx.work, "in", `${i}-still.mp4`);
      await ffmpeg([
        "-loop", "1", "-t", "4", "-i", raw,
        "-f", "lavfi", "-t", "4", "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", "scale='if(gte(iw,ih),trunc(min(1920,iw)/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(1920,ih)/2)*2)',fps=30,format=yuv420p",
        "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-shortest", file,
      ]);
      const p = await probe(file);
      Object.assign(clip, { file, fileStart: 0, fileLength: 4, width: p.width, height: p.height });
      clip.sheets = [file.replace(/\.mp4$/, ".jpg")];
      await ffmpeg(["-i", file, "-frames:v", "1", "-vf", "scale=540:-2", clip.sheets[0]]);
      clips.push(clip);
      continue;
    }
    const range = opts.ranges?.find((r) => r.index === i);
    if (range && range.end > range.start + 0.5) {
      clip.offset = clamp(range.start, 0, Math.max(0, clip.duration - 1));
      clip.duration = clamp(range.end, clip.offset + 0.5, clip.duration) - clip.offset;
    }
    // What was learned about this clip before (Drive: Analysis/<fileId>.json).
    const saved = await ctx.store.readAnalysis(fileId).catch(() => null);
    const key = analysisKey(clip.offset, clip.duration);
    const prev = saved?.parts[key];
    const wantModel = opts.fastModel ? "base" : ctx.settings.advanced.whisperModel;
    // A transcript from a smaller model is fine when only timing is needed; otherwise it must be at least as good.
    const ORDER = ["base", "small", "medium", "large-v3-turbo"];
    const prevTranscriptOk = !!prev?.transcript && ORDER.indexOf(prev.transcript.model) >= ORDER.indexOf(wantModel);
    clip.notes = prev?.notes || "";
    let learnedSomething = false;
    // Pictures and sound are analysed at the same time.
    const picture = (async () => {
      if (!opts.analyze) return;
      const sh = await frameSheets(raw, clip.duration, path.join(ctx.work, `sheet-${i}`), 48, { start: clip.offset, fast: true });
      clip.sheets = sh.files;
      clip.sheetStep = sh.step;
      if (prev?.pictureDesc) clip.pictureDesc = prev.pictureDesc;
      else {
        clip.pictureDesc = describePicture(await pictureStats(raw, clip.duration, clip.offset));
        learnedSomething = true;
      }
    })();
    const sound = (async () => {
      if (!clip.hasAudio) return;
      if (prev?.audioDesc && (refs[i].words || prevTranscriptOk || !opts.transcribe)) {
        // Everything about the sound is already known: no need to even extract it.
        clip.audioDesc = prev.audioDesc;
        if (refs[i].words) clip.transcript = { language: refs[i].language ?? "", words: refs[i].words!, text: refs[i].words!.map((w) => w.text).join(" ") };
        else if (prev.transcript) clip.transcript = { language: prev.transcript.language, words: prev.transcript.words, text: prev.transcript.words.map((w) => w.text).join(" ") };
        return;
      }
      const wav = await extractWav(raw, path.join(ctx.work, `audio-${i}.wav`), clip.offset, clip.duration);
      if (opts.analyze || !prev?.audioDesc) {
        clip.audioDesc = prev?.audioDesc || describeAudioMap(audioMap(wav));
        learnedSomething = learnedSomething || !prev?.audioDesc;
      }
      if (refs[i].words) {
        clip.transcript = { language: refs[i].language ?? "", words: refs[i].words!, text: refs[i].words!.map((w) => w.text).join(" ") };
      } else if (prevTranscriptOk && prev?.transcript) {
        clip.transcript = { language: prev.transcript.language, words: prev.transcript.words, text: prev.transcript.words.map((w) => w.text).join(" ") };
      } else if (opts.transcribe) {
        await ctx.update({ stage: `Listening to clip ${i + 1} of ${refs.length}`, progress: 0.05 + (0.15 * i) / refs.length });
        try {
          clip.transcript = await ctx.ai.transcribe(wav, wantModel, opts.captionLanguage);
          clip.transcriptModel = wantModel;
          learnedSomething = true;
        } catch (e) {
          log("Transcription failed, continuing without it:", String(e));
        }
      }
    })();
    await Promise.all([picture, sound]);
    if (learnedSomething) await saveAnalysis(ctx, clip, saved).catch((e) => log("Couldn't save clip analysis:", String(e)));
    clips.push(clip);
  }
  return clips;
}

// Encoding settings for each output quality.
export const QUALITY = {
  standard: { crf: 20, preset: "veryfast", scale: 1 },
  high: { crf: 16, preset: "medium", scale: 1 },
  ultra: { crf: 16, preset: "medium", scale: 2 },
} as const;
const qualityOf = (req: { quality?: keyof typeof QUALITY }) => QUALITY[req.quality ?? "high"];

/** Turns the chosen background into something the compositor can use, or null for none. */
async function resolveBackground(ctx: Ctx, req: EditSpec["request"]): Promise<BackgroundSource | null> {
  const bg = req.background;
  if (!bg || bg.mode === "none") return null;
  if (!(await mattingAvailable())) {
    log("Background replacement isn't installed on this computer yet (press Update on the website). Keeping the original background.");
    return null;
  }
  if (bg.mode === "blur") return { kind: "blur" };
  if (bg.mode === "color") return { kind: "color", color: bg.color || "#1b2a6b" };
  const format = req.format ?? "reel";
  // A soft camera blur on real photos/videos, scaled to the frame size.
  const blur = bg.depthBlur === false ? 0 : format === "youtube" ? 6 : 8;
  if (bg.mode === "studio") {
    const p = backdropById(bg.preset) ?? backdropById("beams-royal")!;
    await ctx.update({ stage: `Preparing the ${p.label} backdrop` });
    return { kind: "video", file: await renderBackdrop(p.light, p.palette, format) };
  }
  if (bg.mode === "stock" && bg.stockId) {
    await ctx.update({ stage: "Downloading the background" });
    const f = bg.stockKind === "video" ? await footageById(bg.stockId) : await photoById(bg.stockId);
    if (f) return bg.stockKind === "video" ? { kind: "video", file: f, blur } : { kind: "image", file: f, blur };
    log("Stock background unavailable (check the Pixabay key); blurring the real background instead.");
    return { kind: "blur" };
  }
  if (bg.mode === "mine" && bg.mineFileId) {
    const name = bg.mineName || (await ctx.store.fileName(bg.mineFileId));
    const local = await ctx.store.download(bg.mineFileId, path.join(ctx.work, "bg", `mine-${safeName(name, 30)}${path.extname(name) || ".jpg"}`));
    return isImageName(name) ? { kind: "image", file: local, blur } : { kind: "video", file: local, blur };
  }
  return null;
}

/**
 * Makes full-quality pieces of only the parts the plans use (plus a little
 * margin), steadied and with cleaned-up sound if asked. Much faster than
 * processing whole clips.
 */
async function materializeClips(ctx: Ctx, clips: PreparedClip[], plans: EditPlan[], req: EditSpec["request"]) {
  const windows = new Map<number, [number, number]>();
  const add = (i: number, a: number, b: number) => {
    const c = clips[i];
    if (!c || c.isImage) return;
    const w = windows.get(i);
    windows.set(i, [Math.min(w?.[0] ?? Infinity, a), Math.max(w?.[1] ?? -Infinity, b)]);
  };
  for (const plan of plans) {
    let total = 0;
    for (const sg of plan.segments) {
      add(Math.round(sg.clip), sg.start, sg.end);
      total += Math.max(0, sg.end - sg.start) / clamp(sg.speed || 1, 0.5, 2);
    }
    for (const ov of plan.overlays ?? []) add(Math.round(ov.clip), 0, Math.min(6, clips[Math.round(ov.clip)]?.duration ?? 6));
    if (plan.audioBed && plan.audioBed.clip >= 0) add(plan.audioBed.clip, plan.audioBed.start, plan.audioBed.start + total);
  }
  let n = 0;
  const pending = [...windows].filter(([i, [a, b]]) => {
    const c = clips[i];
    const start = clamp(a - 0.6, 0, c.duration);
    const end = clamp(b + 0.6, start + 0.5, c.duration);
    return !(c.file && c.fileStart <= start + 0.05 && c.fileStart + c.fileLength >= end - 0.25);
  });
  if (!pending.length) return;
  const background = await resolveBackground(ctx, req).catch((e) => (log("Background setup failed:", String(e)), null));
  const out16x9 = (req.format ?? "reel") === "youtube";
  const canvas = out16x9 ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
  // Studio lighting on the speaker: always with a new background; on its own for
  // talking/sermon videos (songs and montages usually have many people in frame).
  const speakerStyle = plans.some((p) => p.style === "talking-head" || p.style === "sermon");
  const relight = req.relight !== false && (!!background || speakerStyle);
  const needMatte = (!!background || relight) && (await mattingAvailable());
  const q = qualityOf(req);
  for (const [i, [a, b]] of pending) {
    const c = clips[i];
    const start = clamp(a - 0.6, 0, c.duration);
    const end = clamp(b + 0.6, start + 0.5, c.duration);
    n++;
    await checkCancelled(ctx);
    await ctx.update({ stage: `Preparing the used part of clip ${i + 1} (${(end - start).toFixed(0)}s, full quality)`, progress: 0.35 + 0.05 * (n / windows.size) });
    // Processed pieces are kept on the studio computer: the same part of the same clip
    // with the same settings is never processed twice (new edits, other shapes, revisions).
    const cacheDir = sub("cache", "pieces");
    const pieceKey = hashKey({ f: c.fileId, s: +(c.offset + start).toFixed(2), l: +(end - start).toFixed(2), st: req.stabilize ?? "auto", ca: req.cleanAudio ?? true, q: q.crf, p: q.preset });
    const finishKey = needMatte
      ? hashKey({ pieceKey, bg: req.background, relight, canvas: background ? canvas : null, v: 2 })
      : null;
    const cachedFinal = path.join(cacheDir, `${finishKey ?? pieceKey}.mp4`);
    if (fs.existsSync(cachedFinal) && fs.statSync(cachedFinal).size > 0) {
      const local = intoWork(ctx, cachedFinal, `${i}-cached-${path.basename(cachedFinal)}`);
      const p = await probe(local);
      if (finishKey && background) c.onSet = true;
      Object.assign(c, { file: local, fileStart: start, fileLength: p.duration || end - start, width: p.width || c.width, height: p.height || c.height });
      log(`Clip ${i + 1}: reused the processed part from an earlier edit`);
      continue;
    }
    const out = path.join(cacheDir, `${pieceKey}.mp4`);
    if (!(fs.existsSync(out) && fs.statSync(out).size > 0)) {
      await normalizeVideo(c.raw, `${out}.part.mp4`, {
        crf: q.crf,
        preset: q.preset,
        start: c.offset + start,
        length: end - start,
        stabilize: req.stabilize ?? "auto",
        cleanAudio: req.cleanAudio ?? true,
        workDir: ctx.work,
        onStage: (m) => void ctx.update({ stage: `${m} (clip ${i + 1})` }).catch(() => undefined),
      });
      fs.renameSync(`${out}.part.mp4`, out);
    }
    let final = out;
    if (needMatte) {
      // Find the person in every frame, then relight them and/or put them on the new background.
      try {
        const what = background ? "Removing the background" : "Finding the speaker for studio lighting";
        await ctx.update({ stage: `${what} (clip ${i + 1})` });
        const matte = path.join(cacheDir, `${pieceKey}-matte.mp4`);
        if (!(fs.existsSync(matte) && fs.statSync(matte).size > 0)) {
          await makeMatte(out, `${matte}.part.mp4`, (p) => void ctx.update({ stage: `${what} (clip ${i + 1}): ${Math.round(p * 100)}%` }).catch(() => undefined));
          fs.renameSync(`${matte}.part.mp4`, matte);
        }
        await ctx.update({ stage: background ? `Placing on the new background with studio lighting (clip ${i + 1})` : `Adding studio lighting (clip ${i + 1})` });
        await finishSubject(out, matte, background, `${cachedFinal}.part.mp4`, { relight, crf: q.crf, preset: q.preset, canvas });
        fs.renameSync(`${cachedFinal}.part.mp4`, cachedFinal);
        final = cachedFinal;
        if (background) c.onSet = true;
      } catch (e) {
        log("Studio finishing failed, keeping the original:", e instanceof Error ? e.message : String(e));
      }
    }
    const local = intoWork(ctx, final, `${i}-${path.basename(final)}`);
    const p = await probe(local);
    Object.assign(c, { file: local, fileStart: start, fileLength: p.duration || end - start, width: p.width || c.width, height: p.height || c.height });
  }
  pruneCache(sub("cache", "pieces"), 20 * 1024 ** 3);
}

const hashKey = (o: unknown) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 20);

/** Makes a cached file available inside the job folder (hard link: no copy, no extra space). */
function intoWork(ctx: Ctx, file: string, name: string): string {
  const dest = path.join(ctx.work, "in", name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) return dest;
  try {
    fs.linkSync(file, dest);
  } catch {
    fs.copyFileSync(file, dest);
  }
  return dest;
}

function editPromptFor(ctx: Ctx, req: EditSpec["request"], clips: PreparedClip[], targetSeconds = req.targetSeconds) {
  return editPrompt({
    s: ctx.settings,
    userPrompt: req.prompt,
    targetSeconds,
    clips: clips.map((c) => ({
      index: c.index,
      name: c.name,
      duration: c.duration,
      width: c.width,
      height: c.height,
      hasAudio: c.hasAudio,
      isImage: c.isImage,
      sheets: c.sheets.map((f) => path.basename(f)),
      sheetStep: c.sheetStep,
      transcript: transcriptText(c.transcript),
      audio: c.audioDesc,
      picture: c.pictureDesc,
      notes: c.notes,
    })),
    layout: req.layout,
    captions: req.captions,
    captionLanguage: req.captionLanguage,
    editType: req.editType ?? "auto",
    lyrics: req.lyrics ?? "",
    songTitle: req.songTitle ?? "",
    singer: req.singer ?? "",
    focus: req.focus ?? "",
    hookOptions: req.hookOptions ?? 1,
    autoColor: req.autoColor ?? true,
    background: req.background?.mode ?? "none",
    format: req.format ?? "reel",
    fullLength: !!req.fullLength,
    editStyle: req.editStyle ?? "professional",
    captionStyle: (req.captionChoice ?? { style: ctx.settings.captions.onVideoStyle }).style,
    effects: req.effects,
    titleStyle: req.titleStyle ?? "card",
    eventName: req.eventName ?? "",
    credits: req.credits ?? "",
  });
}

function clipRefs(clips: PreparedClip[]): ClipRef[] {
  return clips.map((c) => ({ fileId: c.fileId, name: c.name, words: c.transcript?.words ?? [], language: c.transcript?.language }));
}

export async function runEditJob(ctx: Ctx) {
  const req = ctx.job.request;
  if (req.type !== "edit") throw new Error("wrong job type");
  await startFileServer();
  const url = mount(ctx.job.id, ctx.work);
  const t0 = Date.now();
  try {
    const clips = await prepareClips(
      ctx,
      req.inputFileIds.map((id, i) => ({ fileId: id, name: req.inputNames[i] || "" })),
      {
        captionLanguage: req.captionLanguage,
        ranges: req.ranges,
        // Montages without captions don't need words; pasted lyrics only need rough timing.
        transcribe: !(req.editType === "montage" && !req.captions),
        fastModel: !!req.lyrics?.trim(),
        analyze: true,
      },
    );
    for (const c of clips) if (!c.name) c.name = await ctx.store.fileName(c.fileId);
    await checkCancelled(ctx);
    await ctx.update({ stage: "Claude is watching the clips and planning the edit", progress: 0.25 });
    const planOpts = { cwd: ctx.work, allowRead: true, model: model(ctx) };
    const lengths = [req.targetSeconds, ...(req.extraLengths ?? []).filter((l) => Math.abs(l - req.targetSeconds) >= 3)];
    const plans: Array<{ plan: EditPlan; seconds: number }> = [];
    for (let k = 0; k < lengths.length; k++) {
      if (k > 0) await ctx.update({ stage: `Claude is planning the ${lengths[k]}s version`, progress: 0.25 + 0.05 * k });
      plans.push({ plan: enforceEffects(await ctx.ai.plan("edit", editPromptFor(ctx, req, clips, lengths[k]), EditPlan, planOpts), req.effects), seconds: lengths[k] });
    }
    // Keep Claude's notes about each clip for next time (Drive: Analysis/).
    for (const n of plans[0].plan.clipNotes ?? []) {
      const c = clips[n.clip];
      if (c && !c.isImage && n.notes.trim()) {
        c.notes = n.notes.trim();
        await saveAnalysis(ctx, c, await ctx.store.readAnalysis(c.fileId).catch(() => null), c.notes).catch((e) => log("Couldn't save clip notes:", String(e)));
      }
    }
    await materializeClips(ctx, clips, plans.map((p) => p.plan), req);
    log(`[${ctx.job.id}] analysis + planning + prep took ${Math.round((Date.now() - t0) / 1000)}s`);

    const folderId = await ctx.store.outputFolder(today(ctx.settings.auto.timezone), ctx.job.id);
    const outputs: OutputItem[] = [];
    // Versions: each length, plus extra hook options on the main length.
    const jobsToRender: Array<{ plan: EditPlan; label: string; qa: boolean }> = [];
    plans.forEach((p, k) => jobsToRender.push({ plan: p.plan, label: lengths.length > 1 ? `${p.seconds}s` : "", qa: k === 0 && !!req.qualityCheck }));
    // Extra hook versions only make sense when the hook is actually shown.
    const hookShown = !req.effects || plans[0].plan.titleStyle === "pro";
    const alt = hookShown ? (plans[0].plan.altHooks ?? []).filter((h) => h.trim()).slice(0, Math.max(0, (req.hookOptions ?? 1) - 1)) : [];
    alt.forEach((h, k) => jobsToRender.push({ plan: { ...plans[0].plan, hook: h.trim() }, label: `hook ${k + 2}`, qa: false }));
    for (let k = 0; k < jobsToRender.length; k++) {
      const j = jobsToRender[k];
      const spec: EditSpec = {
        source: "edit",
        request: req,
        plan: j.plan,
        clips: clipRefs(clips),
        showCaptions: req.captions && j.plan.showCaptions,
        branding: req.branding,
        // The request's text look still applies; spec.captionChoice is only set by later revisions.
        captionChoice: req.effects ? undefined : req.captionChoice,
      };
      const span = 0.5 / jobsToRender.length;
      outputs.push(
        await renderEditSpec(ctx, spec, clips, url, folderId, {}, { label: j.label, qa: j.qa, progressFrom: 0.42 + span * k, progressSpan: span, versionNo: k + 1, versions: jobsToRender.length }),
      );
      await ctx.update({ outputs: [...outputs] });
    }
    if (req.alsoCarousel) {
      // Same message, second format: a carousel built from what was said.
      await ctx.update({ stage: "Turning the video into a carousel", progress: 0.94, outputs: [...outputs] });
      const plan = plans[0].plan;
      const presets = ctx.settings.auto.presets.filter((p) => !MEDIA_PRESETS.includes(p));
      const said = (req.lyrics?.trim() || clips.map((c) => c.transcript?.text ?? "").join(" ")).slice(0, 4000);
      const cplan = await ctx.ai.plan(
        "carousel",
        carouselFromVideoPrompt({ s: ctx.settings, transcript: said, reelTitle: plan.title, reelCaption: plan.caption, presets: presets.length ? presets : ["paper"] }),
        CarouselPlan,
        { cwd: ctx.work, model: model(ctx) },
      );
      const cspec = await resolveCarousel(ctx, cplan, presets.length ? presets : ["paper"], plan.captionLanguage, 7, { used: [] });
      cspec.branding = req.branding;
      outputs.push(await renderCarouselSpec(ctx, cspec, await brandProps(ctx, url, req.branding), folderId, {}));
    }
    log(`[${ctx.job.id}] edit finished in ${Math.round((Date.now() - t0) / 1000)}s`);
    return outputs;
  } finally {
    unmount(ctx.job.id);
  }
}

/** Keeps a plan inside the owner's ticked effects (Claude is told, this makes sure). */
function enforceEffects(plan: EditPlan, e?: Effects): EditPlan {
  if (!e) return plan;
  const zoomOk: Record<string, string> = { none: "still", in: "push", out: "push", punch: "punch", pan: "pan" };
  const fallbackZoom = (["still", "push", "punch", "pan"] as const).find((m) => e.moves.includes(m));
  const zoomOf: Record<string, EditPlan["segments"][number]["zoom"]> = { still: "none", push: "in", punch: "punch", pan: "pan" };
  return {
    ...plan,
    titleStyle: plan.titleStyle === "none" || (e.titles as readonly string[]).includes(plan.titleStyle) ? plan.titleStyle : ((e.titles[0] as EditPlan["titleStyle"]) ?? "none"),
    captionStyle: plan.captionStyle === "none" || (e.captions as readonly string[]).includes(plan.captionStyle) ? plan.captionStyle : ((e.captions[0] as EditPlan["captionStyle"]) ?? "none"),
    look: (e.looks as readonly string[]).includes(plan.look) ? plan.look : ((e.looks[0] as EditPlan["look"]) ?? "natural"),
    transition: plan.transition === "fade" && !e.transitions.includes("dissolve") ? "cut" : plan.transition === "cut" && !e.transitions.includes("cut") && !e.transitions.includes("beat") && e.transitions.includes("dissolve") ? "fade" : plan.transition,
    segments: plan.segments.map((sg) => ((e.moves as readonly string[]).includes(zoomOk[sg.zoom] ?? "still") || !fallbackZoom ? sg : { ...sg, zoom: zoomOf[fallbackZoom] })),
    storyLines: e.extras.includes("story") ? plan.storyLines : [],
    overlays: e.extras.includes("cards") ? plan.overlays : [],
  };
}

/** The opening title: small song card, poster card, or "MONTH recap" opener. */
function titleCardFor(ctx: Ctx, req: EditSpec["request"], planTitle: string, chosen?: string): ClipEditProps["titleCard"] {
  const style = (chosen ?? req.titleStyle ?? "card") as "card" | "poster" | "recap" | "pro" | "none";
  if (style === "none" || style === "pro") return undefined;
  const now = new Date();
  const tz = ctx.settings.auto.timezone;
  const month = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long" }).format(now);
  const year = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(now);
  if (style === "poster") return { style, title: req.songTitle?.trim() || planTitle, header: req.eventName?.trim() || undefined, date: `${month} ${year}`, subtitle: req.singer?.trim() || undefined };
  if (style === "recap") return { style, title: req.songTitle?.trim() || month, subtitle: "recap" };
  return req.songTitle?.trim() ? { style: "card", title: req.songTitle.trim(), subtitle: req.singer?.trim() || undefined } : undefined;
}

/** Maps a time in a clip (seconds, clip time) to the output timeline (ms), or null if not shown. */
function timeMapper(segments: Array<{ clip: number; start: number; end: number; rate: number; outStart: number }>, bed?: { clip: number; start: number }) {
  return (clip: number, t: number): number | null => {
    if (bed) return clip === bed.clip && t >= bed.start ? (t - bed.start) * 1000 : null;
    for (const sg of segments) if (sg.clip === clip && t >= sg.start - 0.05 && t <= sg.end + 0.05) return sg.outStart + ((t - sg.start) / sg.rate) * 1000;
    return null;
  };
}

interface RenderOpts {
  label?: string;
  qa?: boolean;
  progressFrom?: number;
  progressSpan?: number;
  versionNo?: number;
  versions?: number;
}

function buildEditProps(ctx: Ctx, spec: EditSpec, clips: PreparedClip[], url: (f: string) => string, brand: BrandProps): ClipEditProps {
  const s = ctx.settings;
  const { plan, request: req } = spec;
  let layout = spec.layout ?? (req.layout === "auto" ? plan.layout : req.layout);
  // A vertical phone video in a horizontal YouTube frame: keep the whole shot over a blurred fill.
  const yt = (req.format ?? "reel") === "youtube";
  if (yt && !spec.layout && req.layout === "auto" && clips.some((c) => !c.onSet && !c.isImage && c.height > c.width * 1.1)) layout = "blur-pad";
  const gradeIndex = new Map<number, number>();
  const grades: NonNullable<ClipEditProps["grades"]> = [];
  // The chosen look sits on top of each clip's correction.
  const look = req.effects ? plan.look ?? "natural" : "natural";
  const LOOK: Record<string, { exposure: number; contrast: number; highlights: number; saturation: number; warmth: number }> = {
    natural: { exposure: 0, contrast: 0, highlights: 0, saturation: 0, warmth: 0 },
    warm: { exposure: 0.05, contrast: -0.05, highlights: 0.2, saturation: 0.05, warmth: 0.28 },
    cinematic: { exposure: -0.05, contrast: 0.25, highlights: 0.35, saturation: -0.08, warmth: 0.1 },
    airy: { exposure: 0.2, contrast: -0.2, highlights: 0.35, saturation: -0.12, warmth: 0.05 },
    mono: { exposure: 0, contrast: 0.2, highlights: 0.2, saturation: -1, warmth: 0 },
  };
  const lk = LOOK[look] ?? LOOK.natural;
  const corrections = new Map((req.autoColor !== false ? plan.grades ?? [] : []).map((g) => [g.clip, g]));
  if (req.autoColor !== false || look !== "natural") {
    for (const c of clips) {
      if (c.isImage) continue;
      const g = corrections.get(c.index) ?? { exposure: 0, contrast: 0, highlights: 0, saturation: 0, warmth: 0 };
      gradeIndex.set(c.index, grades.length);
      grades.push({
        exposure: clamp(g.exposure + lk.exposure, -1, 1),
        contrast: clamp(g.contrast + lk.contrast, -1, 1),
        highlights: clamp(g.highlights + lk.highlights, 0, 1),
        saturation: look === "mono" ? -1 : clamp(g.saturation + lk.saturation, -1, 1),
        warmth: clamp(g.warmth + lk.warmth, -1, 1),
      });
    }
  }
  const bedClip = plan.audioBed && plan.audioBed.clip >= 0 ? clips[plan.audioBed.clip] : undefined;
  const bed = bedClip && bedClip.hasAudio && bedClip.file ? { clip: bedClip.index, start: clamp(plan.audioBed!.start, 0, bedClip.duration) } : undefined;

  const segments: ClipSegment[] = [];
  const map: Array<{ clip: number; start: number; end: number; rate: number; outStart: number }> = [];
  let outMs = 0;
  const planned = plan.segments.filter((sg) => clips[clamp(Math.round(sg.clip), 0, clips.length - 1)]);
  planned.forEach((seg, i) => {
    const c = clips[clamp(Math.round(seg.clip), 0, clips.length - 1)];
    if (!c.file) return;
    const start = clamp(seg.start, 0, Math.max(0, c.duration - 0.5));
    const end = clamp(seg.end, start + 0.5, c.duration);
    if (end - start < 0.5) return;
    const rate = clamp(seg.speed || 1, 0.5, 2);
    const next = planned[i + 1];
    const prev = planned[i - 1];
    const continuous = (a?: typeof seg, b?: typeof seg) => !!a && !!b && a.clip === b.clip && Math.abs(a.end - b.start) < 0.08;
    const frames = Math.max(1, Math.round(((end - start) / rate) * FPS));
    segments.push({
      src: url(c.file),
      srcWidth: c.width,
      srcHeight: c.height,
      start: start - c.fileStart,
      end: end - c.fileStart,
      playbackRate: rate,
      zoom: seg.zoom,
      layout,
      textOverlay: seg.textOverlay?.trim() || undefined,
      // On a virtual set the shot is already composed: only gentle moves on top.
      focusX: c.onSet ? 0.5 : seg.focusX === undefined ? undefined : clamp(seg.focusX, 0, 1),
      focusY: c.onSet ? 0.4 : seg.focusY === undefined ? undefined : clamp(seg.focusY, 0, 1),
      focusEndX: c.onSet ? 0.5 : seg.focusEndX === undefined ? undefined : clamp(seg.focusEndX, 0, 1),
      focusEndY: c.onSet ? 0.4 : seg.focusEndY === undefined ? undefined : clamp(seg.focusEndY, 0, 1),
      crop: c.onSet ? Math.min(seg.crop ?? 1, 1.1) : seg.crop === undefined ? undefined : clamp(seg.crop, 1, 1.8),
      grade: gradeIndex.get(c.index),
      audioFadeIn: continuous(prev, seg) ? 0 : 3,
      audioFadeOut: continuous(seg, next) ? 0 : next ? 3 : 18,
    });
    map.push({ clip: c.index, start, end, rate, outStart: outMs });
    outMs += (frames / FPS) * 1000;
  });
  if (!segments.length) throw new Error("The edit plan had no usable segments.");
  const transition = segments.length > 1 ? plan.transition : "cut";
  if (transition === "fade") {
    // Fades overlap neighbouring segments: shift the output timeline accordingly.
    let acc = 0;
    map.forEach((m, i) => {
      m.outStart = acc;
      acc += ((m.end - m.start) / m.rate) * 1000 - (i < map.length - 1 ? (TRANSITION_FRAMES / FPS) * 1000 : 0);
    });
  }
  const toOut = timeMapper(map, bed);

  // Captions: words from whichever source is heard.
  const words: CaptionWord[] = [];
  for (const c of clips) {
    if (bed && c.index !== bed.clip) continue;
    for (const w of c.transcript?.words ?? []) {
      const a = toOut(c.index, w.startMs / 1000);
      const b = toOut(c.index, w.endMs / 1000);
      if (a !== null && b !== null && b > a) words.push({ text: w.text, startMs: a, endMs: b });
    }
  }
  words.sort((x, y) => x.startMs - y.startMs);

  // Lyrics: times are in the sound source; with segments, find the clip that's heard.
  const lyrics: NonNullable<ClipEditProps["lyrics"]> = [];
  const lyricClip = bed?.clip ?? map[0]?.clip ?? 0;
  for (const l of plan.lyricLines ?? []) {
    if (!l.text.trim()) continue;
    const candidates = bed ? [lyricClip] : [...new Set(map.map((m) => m.clip))];
    for (const ci of candidates) {
      const a = toOut(ci, l.start);
      const b = toOut(ci, l.end) ?? (a !== null ? a + (l.end - l.start) * 1000 : null);
      if (a !== null && b !== null && b > a) {
        lyrics.push({ text: l.text.trim(), startMs: a, endMs: b });
        break;
      }
    }
  }

  const baseChoice = spec.captionChoice ?? req.captionChoice ?? { style: s.captions.onVideoStyle, look: s.captions.look };
  // With ticked effects, Claude's pick decides the caption style (a revision's explicit choice still wins).
  const choice = req.effects && !spec.captionChoice ? { ...baseChoice, style: plan.captionStyle ?? baseChoice.style } : baseChoice;
  const telugu = plan.captionLanguage === "telugu";
  const total = outMs / 1000;
  const overlays: NonNullable<ClipEditProps["overlays"]> = [];
  for (const ov of plan.overlays ?? []) {
    const c = clips[Math.round(ov.clip)];
    if (!c || !c.file) continue;
    const at = clamp(ov.at, 0, Math.max(0, total - 1));
    overlays.push({
      src: url(c.isImage ? c.raw : c.file),
      type: c.isImage ? "image" : "video",
      at,
      duration: clamp(ov.duration, 1.2, Math.min(6, total - at)),
      position: ov.position,
      aspect: c.width / Math.max(1, c.height),
    });
  }
  const showWords = spec.showCaptions && choice.style !== "none";
  const endCard = (spec.branding ?? req.branding)?.endCard;
  const claudeLine = endCard ? endCard.claudeWrites : s.brand.outro.claudeWrites;
  return {
    format: req.format ?? "reel",
    editStyle: req.editStyle ?? "professional",
    segments,
    transition,
    captions: {
      words: showWords ? words : [],
      // Pasted lyrics use the lyric styles (window / typewriter / worship lyrics); speech uses the rest.
      style: lyrics.length
        ? choice.style === "window" || choice.style === "typewriter"
          ? choice.style
          : "lyrics"
        : showWords
          ? choice.style === "lyrics"
            ? "lines"
            : choice.style
          : "none",
      language: telugu ? "telugu" : "english",
      emphasis: plan.emphasis ?? [],
      look: choice.look,
    },
    lyrics: lyrics.length && spec.showCaptions !== false ? lyrics : undefined,
    titleCard: titleCardFor(ctx, req, plan.title, req.effects ? plan.titleStyle : undefined),
    story: (plan.storyLines ?? [])
      .filter((l) => l.text.trim())
      .map((l) => ({ text: l.text.trim(), startMs: clamp(l.at, 0, total) * 1000, endMs: clamp(l.at + clamp(l.duration, 1.5, 5), 0, total) * 1000 }))
      .filter((l) => l.endMs > l.startMs + 800),
    grades,
    audioBed: bed ? { src: url(clips[bed.clip].file!), start: bed.start - clips[bed.clip].fileStart, fadeOutFrames: 24 } : undefined,
    overlays,
    sfx: undefined,
    cta: claudeLine ? plan.cta?.trim() || undefined : undefined,
    hook: req.effects && plan.titleStyle !== "pro" ? undefined : plan.hook.trim() || undefined,
    brand,
    keepAudio: req.keepOriginalAudio && clips.some((c) => c.hasAudio),
    preset: "night",
  };
}

async function renderEditSpec(ctx: Ctx, spec: EditSpec, clips: PreparedClip[], url: (f: string) => string, folderId: string, lineage: Lineage, ro: RenderOpts = {}) {
  const s = ctx.settings;
  const from = ro.progressFrom ?? 0.42;
  const span = ro.progressSpan ?? 0.45;
  const brand = await brandProps(ctx, url, spec.branding ?? spec.request.branding);
  const props = buildEditProps(ctx, spec, clips, url, brand);
  const songLike = spec.plan.style === "worship" || !!props.audioBed || (props.lyrics?.length ?? 0) > 0;
  const fx = spec.request.effects;
  const wantSfx = fx ? fx.extras.includes("sfx") : s.captions.soundEffects && spec.request.editStyle === "creator";
  if (fx && !fx.extras.includes("endcard")) brand.outro = { ...brand.outro, enabled: false };
  if (wantSfx && !songLike && spec.plan.style !== "sermon") {
    const f = await makeSfx(sub("sfx"));
    const dir = path.join(ctx.work, "sfx");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(f.whoosh, path.join(dir, "whoosh.mp3"));
    fs.copyFileSync(f.pop, path.join(dir, "pop.mp3"));
    props.sfx = { whoosh: url(path.join(dir, "whoosh.mp3")), pop: url(path.join(dir, "pop.mp3")) };
  }

  await checkCancelled(ctx);
  const tag = ro.versions && ro.versions > 1 ? ` (version ${ro.versionNo} of ${ro.versions}${ro.label ? `: ${ro.label}` : ""})` : "";
  await ctx.update({ stage: `Rendering the edit${tag}`, progress: from });
  const base = safeName(spec.plan.title || "edit") + (ro.label ? `-${safeName(ro.label, 12)}` : "");
  const slug = base + (lineage.version && lineage.version > 1 ? `-v${lineage.version}` : "");
  const master = path.join(ctx.work, `${slug}-master.mp4`);
  const rq = qualityOf(spec.request);
  let duration = await renderClipEdit(
    props,
    master,
    (p) => {
      void ctx.update({ progress: from + span * 0.8 * p }).catch(() => undefined);
    },
    rq,
  );

  if (ro.qa) {
    // Claude watches the result and fixes what's wrong, once.
    try {
      await ctx.update({ stage: "Claude is checking the finished reel", progress: from + span * 0.8 });
      const sh = await frameSheets(master, duration, path.join(ctx.work, `${slug}-check`), 36);
      const review = await ctx.ai.plan(
        "review",
        editReviewPrompt(editPromptFor(ctx, spec.request, clips), spec.plan, sh.files.map((f) => path.basename(f)), sh.step, duration),
        EditReview,
        { cwd: ctx.work, allowRead: true, model: model(ctx) },
      );
      if (review.verdict === "fix") {
        log(`[${ctx.job.id}] quality check found: ${review.problems.join("; ")}`);
        spec.plan = enforceEffects(review.plan, spec.request.effects);
        spec.showCaptions = spec.request.captions && review.plan.showCaptions;
        await materializeClips(ctx, clips, [review.plan], spec.request);
        const fixed = buildEditProps(ctx, spec, clips, url, brand);
        fixed.sfx = props.sfx;
        await ctx.update({ stage: `Fixing: ${review.problems.slice(0, 2).join("; ").slice(0, 120)}`, progress: from + span * 0.85 });
        duration = await renderClipEdit(fixed, master, undefined, rq);
      }
    } catch (e) {
      log("Quality check skipped:", e instanceof Error ? e.message : String(e));
    }
  }

  const masterHasAudio = (await probe(master)).hasAudio;
  const cover = path.join(ctx.work, `${slug}-cover.jpg`);
  await ffmpeg(["-ss", Math.min(1.5, duration / 3).toFixed(2), "-i", master, "-frames:v", "1", "-q:v", "3", cover]);
  await ctx.update({ stage: `Adding sound versions and uploading${tag}`, progress: from + span * 0.92 });
  const telugu = spec.plan.captionLanguage === "telugu";
  const asrTelugu = telugu && props.captions.words.length > 0;
  return deliverReel(ctx, {
    master,
    duration,
    cover,
    slug,
    title: spec.plan.title + (ro.label ? ` (${ro.label})` : ""),
    caption: spec.plan.caption,
    hashtags: spec.plan.hashtags,
    mood: spec.plan.mood,
    hasVoice: props.keepAudio && masterHasAudio,
    noMusicUnderVoice: songLike,
    format: spec.request.format ?? "reel",
    folderId,
    spec,
    needsReview: asrTelugu,
    reviewNote: asrTelugu ? "Telugu captions come from automatic speech recognition and may have mistakes. Watch before posting." : undefined,
    ...lineage,
  });
}

// ---------------------------------------------------------------------------
// Revisions: quick changes and described changes to an existing output

const SPEED_FACTOR = { slower: 1.25, normal: 1, faster: 0.8 } as const;

function describeChanges(ch: ReviseChanges, instruction: string) {
  const bits: string[] = [];
  if (ch.hook !== undefined) bits.push("new hook");
  if (ch.verseText !== undefined) bits.push("edited verse text");
  if (ch.reference !== undefined) bits.push("new reference");
  if (ch.preset) bits.push(`look: ${ch.preset}`);
  if (ch.speed && ch.speed !== "normal") bits.push(ch.speed);
  if (ch.caption !== undefined) bits.push("new caption");
  if (ch.captions) bits.push(`captions ${ch.captions}`);
  if (ch.layout) bits.push(ch.layout === "fill" ? "fill the screen" : "keep whole frame");
  if (ch.slides) bits.push("edited slides");
  if (ch.branding) bits.push("watermark / end card");
  if (ch.captionChoice) bits.push("text style");
  if (instruction.trim()) bits.push(`“${instruction.trim().slice(0, 120)}”`);
  return bits.join(", ") || "re-rendered";
}

export async function runReviseJob(ctx: Ctx) {
  const req = ctx.job.request;
  if (req.type !== "revise") throw new Error("wrong job type");
  const s = ctx.settings;
  await startFileServer();
  const url = mount(ctx.job.id, ctx.work);
  try {
    await ctx.update({ stage: "Loading the original", progress: 0.03 });
    const raw = await ctx.store.readSpec<AnySpec & { version?: number; title?: string; caption?: string; hashtags?: string[] }>(req.specFileId);
    const prevVersion = (raw as { version?: number }).version ?? 1;
    const lineage: Lineage = { version: prevVersion + 1, revisionOf: req.sourceJobId, changeNote: describeChanges(req.changes, req.instruction) };
    const folderId = await ctx.store.outputFolder(today(s.auto.timezone), ctx.job.id);
    const ch = req.changes;
    const instruction = req.instruction.trim();
    if (ch.branding) (raw as SpecLook).branding = ch.branding;

    if (raw.source === "verse") {
      const spec: VerseSpec = { ...(raw as VerseSpec), item: { ...(raw as VerseSpec).item } };
      if (raw.caption) spec.item.caption = raw.caption;
      if (instruction) {
        await ctx.update({ stage: "Claude is applying your change", progress: 0.1 });
        const presets = [...PRESETS];
        const rev = await ctx.ai.plan(
          "revise",
          verseRevisionPrompt({
            s,
            presets,
            instruction,
            current: {
              hook: spec.item.hook,
              reference: spec.item.reference,
              verseText: spec.text,
              language: spec.item.language,
              teluguReference: spec.item.teluguReference,
              preset: spec.preset,
              emphasis: spec.item.emphasis,
              caption: spec.item.caption,
              hashtags: spec.item.hashtags,
            },
          }),
          VerseRevision,
          { cwd: ctx.work, model: model(ctx) },
        );
        spec.item.hook = rev.hook;
        spec.item.caption = rev.caption;
        spec.item.hashtags = rev.hashtags;
        spec.item.emphasis = rev.emphasis;
        spec.preset = rev.preset === "photo" && !spec.backgroundFileId ? spec.preset : rev.preset;
        spec.speed = (spec.speed || 1) * SPEED_FACTOR[rev.speed];
        if (rev.reference.trim() && rev.reference.trim() !== spec.item.reference) {
          spec.item = { ...spec.item, reference: rev.reference.trim(), teluguText: rev.teluguText, teluguReference: rev.teluguReference };
          const fresh = await resolveVerse(ctx, spec.item, await ctx.store.listBackgrounds(), spec.preset, 0);
          Object.assign(spec, { text: fresh.text, displayRef: fresh.displayRef, needsReview: fresh.needsReview, reviewNote: fresh.reviewNote });
        } else if (spec.item.language === "telugu" && rev.teluguText.trim() && rev.teluguText.trim() !== spec.text) {
          spec.text = rev.teluguText.trim();
          spec.displayRef = rev.teluguReference.trim() || spec.displayRef;
        }
        lineage.changeNote = rev.note || lineage.changeNote;
      }
      // Direct edits win over Claude's suggestions.
      if (ch.hook !== undefined) spec.item.hook = ch.hook;
      if (ch.verseText !== undefined && ch.verseText.trim()) {
        spec.text = ch.verseText.trim();
        spec.needsReview = false;
        spec.reviewNote = undefined;
      }
      if (ch.reference !== undefined && ch.reference.trim()) spec.displayRef = ch.reference.trim();
      if (ch.preset) {
        if (ch.preset === "photo" && !spec.backgroundFileId) {
          const bgs = await ctx.store.listBackgrounds();
          const pick = seededPick(bgs, Date.now());
          if (pick) {
            spec.backgroundFileId = pick.id;
            spec.backgroundName = pick.name;
            spec.preset = "photo";
          }
        } else if (ch.preset === "footage") {
          const f = pixabayEnabled() ? await findFootage(spec.item.footageQuery || spec.item.mood, spec.pixabayId ? [spec.pixabayId] : []) : null;
          if (f) {
            spec.pixabayId = f.id;
            spec.preset = "footage";
          }
        } else spec.preset = ch.preset;
      }
      if (ch.speed) spec.speed = (spec.speed || 1) * SPEED_FACTOR[ch.speed];
      if (ch.caption !== undefined) spec.item.caption = ch.caption;
      const slug = `${safeName(spec.item.title || spec.item.reference)}-v${lineage.version}`;
      await ctx.update({ stage: "Rendering the new version", progress: 0.2 });
      return [await renderVerseSpec(ctx, spec, await brandProps(ctx, url, spec.branding), url, slug, folderId, 0.2, 0.75, lineage)];
    }

    if (raw.source === "carousel") {
      const spec: CarouselSpec = { ...(raw as CarouselSpec), plan: { ...(raw as CarouselSpec).plan } };
      if (instruction) {
        await ctx.update({ stage: "Claude is applying your change", progress: 0.1 });
        const presets = s.auto.presets.filter((p) => !MEDIA_PRESETS.includes(p));
        const plan = await ctx.ai.plan(
          "revise",
          carouselRevisionPrompt({ s, previous: spec.plan, instruction, presets: presets.length ? presets : ["paper"] }),
          CarouselPlan,
          { cwd: ctx.work, model: model(ctx) },
        );
        const history = { used: [] as Array<{ ref: string; date: string }> };
        Object.assign(spec, await resolveCarousel(ctx, plan, presets.length ? presets : [spec.preset], spec.language, plan.slides.length, history));
      }
      if (ch.slides?.length) {
        spec.slides = spec.slides.map((sl, i) => (ch.slides![i] ? { ...sl, title: ch.slides![i].title, body: ch.slides![i].body || undefined } : sl));
      }
      if (ch.preset && !MEDIA_PRESETS.includes(ch.preset)) spec.preset = ch.preset;
      if (ch.caption !== undefined) spec.plan = { ...spec.plan, caption: ch.caption };
      return [await renderCarouselSpec(ctx, spec, await brandProps(ctx, url, spec.branding), folderId, lineage)];
    }

    // Edit
    const spec: EditSpec = { ...(raw as EditSpec), plan: { ...(raw as EditSpec).plan } };
    if (raw.caption) spec.plan.caption = raw.caption;
    const clips = await prepareClips(ctx, spec.clips, {
      captionLanguage: spec.request.captionLanguage,
      ranges: spec.request.ranges,
      transcribe: false,
      fastModel: false,
      analyze: !!instruction,
    });
    if (instruction) {
      await ctx.update({ stage: "Claude is re-watching the clips and applying your change", progress: 0.3 });
      spec.plan = enforceEffects(
        await ctx.ai.plan("revise", editRevisionPrompt(editPromptFor(ctx, spec.request, clips), spec.plan, instruction), EditPlan, {
          cwd: ctx.work,
          allowRead: true,
          model: model(ctx),
        }),
        spec.request.effects,
      );
      spec.showCaptions = spec.request.captions && spec.plan.showCaptions;
    }
    if (ch.captionChoice) spec.captionChoice = ch.captionChoice;
    if (ch.hook !== undefined) spec.plan.hook = ch.hook;
    if (ch.caption !== undefined) spec.plan.caption = ch.caption;
    if (ch.captions) spec.showCaptions = ch.captions === "on";
    if (ch.layout) spec.layout = ch.layout;
    if (ch.speed && ch.speed !== "normal") {
      // Faster = trim each segment's tail; slower = let each run longer.
      const f = ch.speed === "faster" ? 0.8 : 1.2;
      spec.plan.segments = spec.plan.segments.map((sg) => {
        const c = clips[clamp(Math.round(sg.clip), 0, clips.length - 1)];
        return { ...sg, end: clamp(sg.start + (sg.end - sg.start) * f, sg.start + 0.8, c.duration) };
      });
    }
    await materializeClips(ctx, clips, [spec.plan], spec.request);
    return [await renderEditSpec(ctx, spec, clips, url, folderId, lineage)];
  } finally {
    unmount(ctx.job.id);
  }
}
