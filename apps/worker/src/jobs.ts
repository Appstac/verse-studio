import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { type Job, type OutputItem, type ReviseChanges, type Settings, PRESETS } from "../../../shared/schema";
import { FPS, TRANSITION_FRAMES, type BrandProps, type CaptionWord, type ClipEditProps, type ClipSegment, type PresetName, type VerseReelProps } from "../remotion/types";
import { TRANSLATION_LABEL } from "./bible";
import { mount, startFileServer, unmount } from "./fileserver";
import { log } from "./log";
import {
  contactSheet,
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
  VersePlan,
  VerseRevision,
  carouselFromVideoPrompt,
  carouselPrompt,
  carouselRevisionPrompt,
  editPrompt,
  editRevisionPrompt,
  versePrompt,
  verseRevisionPrompt,
  type VerseItem,
} from "./plans";
import { renderClipEdit, renderCover, renderSlide, renderVerseReel } from "./render";
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

export interface VerseSpec {
  source: "verse";
  item: VerseItem;
  text: string;
  displayRef: string;
  preset: PresetName;
  backgroundFileId?: string;
  backgroundName?: string;
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

export interface EditSpec {
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

export interface CarouselSpec {
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

async function brandProps(ctx: Ctx, url: (f: string) => string): Promise<BrandProps> {
  const b = ctx.settings.brand;
  let logoSrc: string | undefined;
  if (b.logoFileId) {
    try {
      const p = await ctx.store.download(b.logoFileId, path.join(ctx.work, "logo.png"));
      logoSrc = url(p);
    } catch (e) {
      log("Logo download failed, continuing without it:", String(e));
    }
  }
  return {
    signatureText: b.signatureText,
    handle: b.handle,
    logoSrc,
    position: b.watermarkPosition,
    opacity: b.watermarkOpacity,
    accent: b.accentColor,
    outro: b.outro,
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

async function variantPlans(ctx: Ctx, mood: string, seed: number, hasVoice: boolean): Promise<VariantPlan[]> {
  const v = ctx.settings.music.variants;
  const out: VariantPlan[] = [];
  if (hasVoice && v.original) out.push({ label: "original", mode: "original" });
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
    folderId: string;
    spec: AnySpec;
    reference?: string;
    needsReview?: boolean;
    reviewNote?: string;
  } & Lineage,
): Promise<OutputItem> {
  const seed = seedOf(opts.slug);
  const plans = await variantPlans(ctx, opts.mood, seed, opts.hasVoice);
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
    const allowed = [...new Set([...presets, ...(backgrounds.length && req.preset === "auto" ? ["photo"] : [])])];

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
      const slug = `${String(i + 1).padStart(2, "0")}-${safeName(it.title || it.reference)}`;
      outputs.push(await renderVerseSpec(ctx, spec, brand, url, slug, folderId, base, step, {}));
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
  return { source: "verse", item: it, text, displayRef, preset, backgroundFileId, backgroundName, speed: 1, needsReview, reviewNote };
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
  const it = spec.item;
  const words = wordCount(spec.text);
  const perWord = it.language === "telugu" ? 0.55 : 0.4;
  const verseSeconds = clamp((words * perWord + 3) * (spec.speed || 1), s.reel.minSeconds - 2, s.reel.maxSeconds * 1.3);
  const hook = s.reel.showHook && it.hook.trim() ? it.hook.trim() : undefined;
  return {
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
  const duration = await renderVerseReel(props, master, (p) => {
    void ctx.update({ progress: base + step * 0.8 * p }).catch(() => undefined);
  });
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
    const presets = req.preset === "auto" ? s.auto.presets.filter((p) => p !== "photo") : [req.preset];
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
  file: string;
  raw: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  isImage: boolean;
  sheet: string;
  transcript?: Transcript;
}

// Phrases with exact start-end times, split wherever she pauses, so Claude can
// cut out pauses and repeated takes precisely.
function transcriptText(t?: Transcript) {
  if (!t || !t.words.length) return "";
  const out: string[] = [];
  let cur: string[] = [];
  let start = t.words[0].startMs;
  let end = t.words[0].endMs;
  const flush = () => {
    if (cur.length) out.push(`[${(start / 1000).toFixed(2)}-${(end / 1000).toFixed(2)}] ${cur.join(" ")}`);
    cur = [];
  };
  for (const w of t.words) {
    const gap = w.startMs - end;
    if (cur.length && (gap > 350 || cur.length >= 12)) {
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

// Downloads, normalises, samples frames from and (unless cached) transcribes each clip.
async function prepareClips(
  ctx: Ctx,
  refs: Array<{ fileId: string; name: string; words?: CaptionWord[]; language?: string }>,
  captionLanguage: "auto" | "en" | "te",
): Promise<PreparedClip[]> {
  const clips: PreparedClip[] = [];
  for (let i = 0; i < refs.length; i++) {
    await checkCancelled(ctx);
    const { fileId, name } = refs[i];
    await ctx.update({ stage: `Preparing clip ${i + 1} of ${refs.length}: ${name}`, progress: 0.02 + (0.2 * i) / refs.length });
    const raw = await ctx.store.download(fileId, path.join(ctx.work, "in", `${i}-${safeName(name, 40)}${path.extname(name) || ".mp4"}`));
    const file = path.join(ctx.work, "in", `${i}-clip.mp4`);
    if (isImageName(name)) {
      await ffmpeg([
        "-loop", "1", "-t", "4", "-i", raw,
        "-f", "lavfi", "-t", "4", "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", "scale='if(gte(iw,ih),trunc(min(1920,iw)/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(1920,ih)/2)*2)',fps=30,format=yuv420p",
        "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-shortest", file,
      ]);
    } else {
      await normalizeVideo(raw, file);
    }
    const info = await probe(file);
    const sheet = path.join(ctx.work, `sheet-${i}.jpg`);
    await contactSheet(file, info.duration, sheet);
    const clip: PreparedClip = {
      index: i,
      fileId,
      name,
      file,
      raw,
      duration: info.duration,
      width: info.width,
      height: info.height,
      hasAudio: info.hasAudio && !isImageName(name),
      isImage: isImageName(name),
      sheet,
    };
    if (refs[i].words) {
      clip.transcript = { language: refs[i].language ?? "", words: refs[i].words!, text: refs[i].words!.map((w) => w.text).join(" ") };
    } else if (clip.hasAudio) {
      await ctx.update({ stage: `Listening to clip ${i + 1} (speech-to-text)`, progress: 0.05 + (0.2 * i) / refs.length });
      try {
        const wav = await extractWav(file, path.join(ctx.work, `audio-${i}.wav`));
        clip.transcript = await ctx.ai.transcribe(wav, ctx.settings.advanced.whisperModel, captionLanguage);
      } catch (e) {
        log("Transcription failed, continuing without it:", String(e));
      }
    }
    clips.push(clip);
  }
  return clips;
}

function editPromptFor(ctx: Ctx, req: EditSpec["request"], clips: PreparedClip[]) {
  return editPrompt({
    s: ctx.settings,
    userPrompt: req.prompt,
    targetSeconds: req.targetSeconds,
    clips: clips.map((c) => ({
      index: c.index,
      name: c.name,
      duration: c.duration,
      width: c.width,
      height: c.height,
      hasAudio: c.hasAudio,
      isImage: c.isImage,
      sheet: path.basename(c.sheet),
      transcript: transcriptText(c.transcript),
    })),
    layout: req.layout,
    captions: req.captions,
    captionLanguage: req.captionLanguage,
  });
}

export async function runEditJob(ctx: Ctx) {
  const req = ctx.job.request;
  if (req.type !== "edit") throw new Error("wrong job type");
  await startFileServer();
  const url = mount(ctx.job.id, ctx.work);
  try {
    const clips = await prepareClips(
      ctx,
      req.inputFileIds.map((id, i) => ({ fileId: id, name: req.inputNames[i] || "" })).map((r) => r),
      req.captionLanguage,
    );
    for (const c of clips) if (!c.name) c.name = await ctx.store.fileName(c.fileId);
    await checkCancelled(ctx);
    await ctx.update({ stage: "Claude is watching the clips and planning the edit", progress: 0.3 });
    const plan = await ctx.ai.plan("edit", editPromptFor(ctx, req, clips), EditPlan, { cwd: ctx.work, allowRead: true, model: model(ctx) });
    const spec: EditSpec = {
      source: "edit",
      request: req,
      plan,
      clips: clips.map((c) => ({ fileId: c.fileId, name: c.name, words: c.transcript?.words ?? [], language: c.transcript?.language })),
      showCaptions: req.captions && plan.showCaptions,
    };
    const folderId = await ctx.store.outputFolder(today(ctx.settings.auto.timezone), ctx.job.id);
    const outputs = [await renderEditSpec(ctx, spec, clips, url, folderId, {})];
    if (req.alsoCarousel) {
      // Same message, second format: a carousel built from what was said.
      await ctx.update({ stage: "Turning the video into a carousel", progress: 0.93, outputs: [...outputs] });
      const presets = ctx.settings.auto.presets.filter((p) => p !== "photo");
      const said = clips.map((c) => c.transcript?.text ?? "").join(" ").slice(0, 4000);
      const cplan = await ctx.ai.plan(
        "carousel",
        carouselFromVideoPrompt({ s: ctx.settings, transcript: said, reelTitle: plan.title, reelCaption: plan.caption, presets: presets.length ? presets : ["paper"] }),
        CarouselPlan,
        { cwd: ctx.work, model: model(ctx) },
      );
      const cspec = await resolveCarousel(ctx, cplan, presets.length ? presets : ["paper"], plan.captionLanguage, 7, { used: [] });
      outputs.push(await renderCarouselSpec(ctx, cspec, await brandProps(ctx, url), folderId, {}));
    }
    return outputs;
  } finally {
    unmount(ctx.job.id);
  }
}

async function renderEditSpec(ctx: Ctx, spec: EditSpec, clips: PreparedClip[], url: (f: string) => string, folderId: string, lineage: Lineage) {
  const s = ctx.settings;
  const { plan, request: req } = spec;
  const layout = spec.layout ?? (req.layout === "auto" ? plan.layout : req.layout);
  const segments: ClipSegment[] = [];
  const segClip: PreparedClip[] = [];
  for (const seg of plan.segments) {
    const c = clips[clamp(Math.round(seg.clip), 0, clips.length - 1)];
    const start = clamp(seg.start, 0, Math.max(0, c.duration - 0.5));
    const end = clamp(seg.end, start + 0.5, c.duration);
    if (end - start < 0.5) continue;
    segments.push({
      src: url(c.file),
      srcWidth: c.width,
      srcHeight: c.height,
      start,
      end,
      playbackRate: clamp(seg.speed || 1, 0.5, 2),
      zoom: seg.zoom,
      layout,
      textOverlay: seg.textOverlay.trim() || undefined,
    });
    segClip.push(c);
  }
  if (!segments.length) throw new Error("The edit plan had no usable segments.");
  const transition = segments.length > 1 ? plan.transition : "cut";

  // Map each clip's word timings onto the output timeline for captions.
  const words: CaptionWord[] = [];
  let offsetFrames = 0;
  segments.forEach((seg, i) => {
    const c = segClip[i];
    const segFramesN = Math.max(1, Math.round(((seg.end - seg.start) / seg.playbackRate) * FPS));
    const offsetMs = (offsetFrames / FPS) * 1000;
    for (const w of c.transcript?.words ?? []) {
      if (w.startMs >= seg.start * 1000 && w.endMs <= seg.end * 1000 + 200) {
        words.push({
          text: w.text,
          startMs: offsetMs + (w.startMs - seg.start * 1000) / seg.playbackRate,
          endMs: offsetMs + (Math.min(w.endMs, seg.end * 1000) - seg.start * 1000) / seg.playbackRate,
        });
      }
    }
    offsetFrames += segFramesN - (transition === "fade" && i < segments.length - 1 ? TRANSITION_FRAMES : 0);
  });

  const hasVoice = req.keepOriginalAudio && clips.some((c) => c.hasAudio);
  const telugu = plan.captionLanguage === "telugu";
  const total = offsetFrames / FPS;
  const overlays: NonNullable<ClipEditProps["overlays"]> = [];
  for (const ov of plan.overlays ?? []) {
    const c = clips[Math.round(ov.clip)];
    if (!c) continue;
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
  let sfx: ClipEditProps["sfx"];
  if (s.captions.soundEffects && plan.style !== "worship") {
    const f = await makeSfx(sub("sfx"));
    const dir = path.join(ctx.work, "sfx");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(f.whoosh, path.join(dir, "whoosh.mp3"));
    fs.copyFileSync(f.pop, path.join(dir, "pop.mp3"));
    sfx = { whoosh: url(path.join(dir, "whoosh.mp3")), pop: url(path.join(dir, "pop.mp3")) };
  }
  const props: ClipEditProps = {
    segments,
    transition,
    captions: {
      words: spec.showCaptions ? words : [],
      style: spec.showCaptions ? s.captions.onVideoStyle : "none",
      language: telugu ? "telugu" : "english",
      emphasis: plan.emphasis ?? [],
    },
    overlays,
    sfx,
    cta: plan.cta?.trim() || undefined,
    hook: plan.hook.trim() || undefined,
    brand: await brandProps(ctx, url),
    keepAudio: hasVoice,
    preset: "night",
  };

  await checkCancelled(ctx);
  await ctx.update({ stage: "Rendering the edit", progress: 0.4 });
  const slug = safeName(plan.title || "edit") + (lineage.version && lineage.version > 1 ? `-v${lineage.version}` : "");
  const master = path.join(ctx.work, `${slug}-master.mp4`);
  const duration = await renderClipEdit(props, master, (p) => {
    void ctx.update({ progress: 0.4 + 0.45 * p }).catch(() => undefined);
  });
  const masterHasAudio = (await probe(master)).hasAudio;
  const cover = path.join(ctx.work, `${slug}-cover.jpg`);
  await ffmpeg(["-ss", Math.min(1.5, duration / 3).toFixed(2), "-i", master, "-frames:v", "1", "-q:v", "3", cover]);
  await ctx.update({ stage: "Adding music versions and uploading", progress: 0.88 });
  return deliverReel(ctx, {
    master,
    duration,
    cover,
    slug,
    title: plan.title,
    caption: plan.caption,
    hashtags: plan.hashtags,
    mood: plan.mood,
    hasVoice: hasVoice && masterHasAudio,
    folderId,
    spec,
    needsReview: telugu && props.captions.words.length > 0,
    reviewNote:
      telugu && props.captions.words.length > 0
        ? "Telugu captions come from automatic speech recognition and may have mistakes. Watch before posting."
        : undefined,
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
        } else spec.preset = ch.preset;
      }
      if (ch.speed) spec.speed = (spec.speed || 1) * SPEED_FACTOR[ch.speed];
      if (ch.caption !== undefined) spec.item.caption = ch.caption;
      const slug = `${safeName(spec.item.title || spec.item.reference)}-v${lineage.version}`;
      await ctx.update({ stage: "Rendering the new version", progress: 0.2 });
      return [await renderVerseSpec(ctx, spec, await brandProps(ctx, url), url, slug, folderId, 0.2, 0.75, lineage)];
    }

    if (raw.source === "carousel") {
      const spec: CarouselSpec = { ...(raw as CarouselSpec), plan: { ...(raw as CarouselSpec).plan } };
      if (instruction) {
        await ctx.update({ stage: "Claude is applying your change", progress: 0.1 });
        const presets = s.auto.presets.filter((p) => p !== "photo");
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
      if (ch.preset && ch.preset !== "photo") spec.preset = ch.preset;
      if (ch.caption !== undefined) spec.plan = { ...spec.plan, caption: ch.caption };
      return [await renderCarouselSpec(ctx, spec, await brandProps(ctx, url), folderId, lineage)];
    }

    // Edit
    const spec: EditSpec = { ...(raw as EditSpec), plan: { ...(raw as EditSpec).plan } };
    if (raw.caption) spec.plan.caption = raw.caption;
    const clips = await prepareClips(ctx, spec.clips, spec.request.captionLanguage);
    if (instruction) {
      await ctx.update({ stage: "Claude is re-watching the clips and applying your change", progress: 0.3 });
      spec.plan = await ctx.ai.plan("revise", editRevisionPrompt(editPromptFor(ctx, spec.request, clips), spec.plan, instruction), EditPlan, {
        cwd: ctx.work,
        allowRead: true,
        model: model(ctx),
      });
      spec.showCaptions = spec.request.captions && spec.plan.showCaptions;
    }
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
    return [await renderEditSpec(ctx, spec, clips, url, folderId, lineage)];
  } finally {
    unmount(ctx.job.id);
  }
}
