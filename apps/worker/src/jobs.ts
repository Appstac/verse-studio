import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { type Job, type OutputItem, type Settings, PRESETS } from "../../../shared/schema";
import { FPS, TRANSITION_FRAMES, type BrandProps, type CaptionWord, type ClipEditProps, type ClipSegment, type PresetName, type VerseReelProps } from "../remotion/types";
import { TRANSLATION_LABEL } from "./bible";
import { mount, startFileServer, unmount } from "./fileserver";
import { log } from "./log";
import {
  contactSheet,
  extractWav,
  ffmpeg,
  isImageName,
  makeVariant,
  normalizeVideo,
  probe,
  safeName,
  type MixMode,
} from "./media";
import { CarouselPlan, EditPlan, VersePlan, carouselPrompt, editPrompt, versePrompt, type VerseItem } from "./plans";
import { renderClipEdit, renderCover, renderSlide, renderVerseReel } from "./render";
import type { MusicFile, Store } from "./store";
import { transcribeWav, type Transcript } from "./whisper";

export interface Planner {
  plan<T>(kind: "verse" | "edit" | "carousel", prompt: string, schema: z.ZodType<T>, opts: { cwd: string; allowRead?: boolean; model?: string }): Promise<T>;
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
      const p = await ctx.store.download(b.logoFileId, path.join(ctx.work, "logo" + ".png"));
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
    reference?: string;
    needsReview?: boolean;
    reviewNote?: string;
  },
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

// ---------------------------------------------------------------------------
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
      { cwd: ctx.work, model: s.advanced.claudeModel || undefined },
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
      const r = await buildVerseProps(ctx, it, brand, url, backgrounds, req.preset === "auto" ? undefined : req.preset, i);
      const slug = `${String(i + 1).padStart(2, "0")}-${safeName(it.title || it.reference)}`;
      const master = path.join(ctx.work, `${slug}-master.mp4`);
      const duration = await renderVerseReel(r.props, master, (p) => {
        void ctx.update({ progress: base + step * 0.8 * p }).catch(() => undefined);
      });
      const cover = path.join(ctx.work, `${slug}-cover.jpg`);
      await renderCover(r.props, cover, r.props.hookSeconds + r.props.verseSeconds * 0.75);
      await ctx.update({ stage: `Reel ${i + 1} of ${items.length}: adding music and uploading`, progress: base + step * 0.85 });
      const out = await deliverReel(ctx, {
        master,
        duration,
        cover,
        slug,
        title: it.title || it.reference,
        caption: it.caption,
        hashtags: it.hashtags,
        mood: it.mood,
        hasVoice: false,
        folderId,
        reference: r.displayRef,
        needsReview: r.needsReview,
        reviewNote: r.reviewNote,
      });
      outputs.push(out);
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

async function buildVerseProps(
  ctx: Ctx,
  it: VerseItem,
  brand: BrandProps,
  url: (f: string) => string,
  backgrounds: Array<{ id: string; name: string }>,
  forcedPreset: PresetName | undefined,
  index: number,
) {
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
  let background: VerseReelProps["background"];
  if (preset === "photo") {
    const pick = seededPick(backgrounds, seedOf(it.reference) + index);
    if (pick) {
      const local = await ctx.store.download(pick.id, path.join(ctx.work, "bg", `${pick.id.replace(/[^\w-]/g, "_")}${path.extname(pick.name)}`));
      if (isImageName(pick.name)) background = { type: "image", src: url(local) };
      else {
        const norm = local.replace(/(\.\w+)$/, "-norm.mp4");
        if (!fs.existsSync(norm)) await normalizeVideo(local, norm);
        const info = await probe(norm);
        background = { type: "video", src: url(norm), durationSeconds: info.duration };
      }
    } else preset = "night";
  }
  const words = wordCount(text);
  const perWord = it.language === "telugu" ? 0.55 : 0.4;
  const verseSeconds = clamp(words * perWord + 3, s.reel.minSeconds - 2, s.reel.maxSeconds);
  const props: VerseReelProps = {
    preset,
    language: it.language,
    hook: s.reel.showHook && it.hook.trim() ? it.hook.trim() : undefined,
    verseText: text,
    reference: displayRef,
    emphasis: it.emphasis,
    background,
    brand,
    verseSeconds,
    hookSeconds: s.reel.showHook && it.hook.trim() ? 2 : 0,
    seed: seedOf(it.reference),
  };
  return { props, displayRef, needsReview, reviewNote };
}

// ---------------------------------------------------------------------------
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
      { cwd: ctx.work, model: s.advanced.claudeModel || undefined },
    );
    const brand = await brandProps(ctx, url);
    const preset = (presets.includes(plan.preset) ? plan.preset : presets[0] ?? "paper") as PresetName;
    const slides = plan.slides.slice(0, req.slides);
    const folderId = await ctx.store.outputFolder(today(s.auto.timezone), ctx.job.id);
    const slug = safeName(plan.title);
    const ids: string[] = [];
    let needsReview = false;
    for (let i = 0; i < slides.length; i++) {
      await checkCancelled(ctx);
      const sl = slides[i];
      let body = sl.body;
      let reference: string | undefined;
      if (sl.verseRef.trim()) {
        try {
          const v = await ctx.ai.verse(sl.verseRef.trim(), s.auto.translation);
          body = `“${v.text}”`;
          reference = v.reference;
          history.used.push({ ref: sl.verseRef.trim(), date: new Date().toISOString() });
        } catch {
          reference = sl.verseRef.trim();
          needsReview = true;
        }
      }
      if (req.language === "telugu") needsReview = true;
      await ctx.update({ stage: `Slide ${i + 1} of ${slides.length}`, progress: 0.2 + (0.7 * i) / slides.length });
      const out = path.join(ctx.work, `${slug}-${String(i + 1).padStart(2, "0")}.png`);
      await renderSlide(
        {
          preset,
          language: req.language === "telugu" ? "telugu" : "english",
          kind: sl.kind,
          index: i,
          total: slides.length,
          title: sl.title,
          body: body || undefined,
          reference,
          brand,
          seed: seedOf(plan.title),
        },
        out,
      );
      ids.push(await ctx.store.upload(out, folderId));
    }
    const tags = normalizeTags(plan.hashtags, s);
    const captionFile = path.join(ctx.work, `${slug}-caption.txt`);
    fs.writeFileSync(captionFile, `${plan.caption.trim()}\n\n${tags.join(" ")}\n`);
    await ctx.store.upload(captionFile, folderId);
    await ctx.store.writeState("history", { used: history.used.slice(-2000) });
    return [
      {
        kind: "carousel" as const,
        title: plan.title,
        caption: plan.caption.trim(),
        hashtags: tags,
        needsReview,
        reviewNote: needsReview ? "Check the Telugu text or scripture wording before posting." : undefined,
        variants: [],
        coverFileId: ids[0],
        slideFileIds: ids,
        folderId,
      },
    ];
  } finally {
    unmount(ctx.job.id);
  }
}

// ---------------------------------------------------------------------------
interface PreparedClip {
  index: number;
  name: string;
  file: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sheet: string;
  transcript?: Transcript;
}

function transcriptText(t?: Transcript) {
  if (!t || !t.words.length) return "";
  const groups: string[] = [];
  let cur: string[] = [];
  let start = t.words[0].startMs;
  for (const w of t.words) {
    if (cur.length && (w.startMs - start > 3000 || cur.length >= 14)) {
      groups.push(`[${(start / 1000).toFixed(1)}s] ${cur.join(" ")}`);
      cur = [];
      start = w.startMs;
    }
    cur.push(w.text);
  }
  if (cur.length) groups.push(`[${(start / 1000).toFixed(1)}s] ${cur.join(" ")}`);
  return groups.join(" ").slice(0, 6000);
}

export async function runEditJob(ctx: Ctx) {
  const req = ctx.job.request;
  if (req.type !== "edit") throw new Error("wrong job type");
  const s = ctx.settings;
  await startFileServer();
  const url = mount(ctx.job.id, ctx.work);
  try {
    const clips: PreparedClip[] = [];
    for (let i = 0; i < req.inputFileIds.length; i++) {
      await checkCancelled(ctx);
      const id = req.inputFileIds[i];
      const name = req.inputNames[i] || (await ctx.store.fileName(id));
      await ctx.update({ stage: `Preparing clip ${i + 1} of ${req.inputFileIds.length}: ${name}`, progress: 0.02 + (0.2 * i) / req.inputFileIds.length });
      const raw = await ctx.store.download(id, path.join(ctx.work, "in", `${i}-${safeName(name, 40)}${path.extname(name) || ".mp4"}`));
      const file = path.join(ctx.work, "in", `${i}-clip.mp4`);
      if (isImageName(name)) {
        await ffmpeg([
          "-loop", "1", "-t", "4", "-i", raw,
          "-f", "lavfi", "-t", "4", "-i", "anullsrc=r=48000:cl=stereo",
          "-vf", "scale='min(1920,iw)':-2,fps=30,format=yuv420p",
          "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-shortest", file,
        ]);
      } else {
        await normalizeVideo(raw, file);
      }
      const info = await probe(file);
      const sheet = path.join(ctx.work, `sheet-${i}.jpg`);
      await contactSheet(file, info.duration, sheet);
      const clip: PreparedClip = { index: i, name, file, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio && !isImageName(name), sheet };
      if (clip.hasAudio) {
        await ctx.update({ stage: `Listening to clip ${i + 1} (speech-to-text)`, progress: 0.05 + (0.2 * i) / req.inputFileIds.length });
        try {
          const wav = await extractWav(file, path.join(ctx.work, `audio-${i}.wav`));
          clip.transcript = await ctx.ai.transcribe(wav, s.advanced.whisperModel, req.captionLanguage);
        } catch (e) {
          log("Transcription failed, continuing without it:", String(e));
        }
      }
      clips.push(clip);
    }

    await checkCancelled(ctx);
    await ctx.update({ stage: "Claude is watching the clips and planning the edit", progress: 0.3 });
    const plan = await ctx.ai.plan(
      "edit",
      editPrompt({
        s,
        userPrompt: req.prompt,
        targetSeconds: req.targetSeconds,
        clips: clips.map((c) => ({
          index: c.index,
          name: c.name,
          duration: c.duration,
          width: c.width,
          height: c.height,
          hasAudio: c.hasAudio,
          sheet: path.basename(c.sheet),
          transcript: transcriptText(c.transcript),
        })),
        layout: req.layout,
        captions: req.captions,
        captionLanguage: req.captionLanguage,
      }),
      EditPlan,
      { cwd: ctx.work, allowRead: true, model: s.advanced.claudeModel || undefined },
    );

    const segments: ClipSegment[] = [];
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
        layout: req.layout === "auto" ? plan.layout : req.layout,
        textOverlay: seg.textOverlay.trim() || undefined,
      });
    }
    if (!segments.length) throw new Error("The edit plan had no usable segments.");
    const transition = segments.length > 1 ? plan.transition : "cut";

    // Map each clip's word timings onto the output timeline for captions.
    const words: CaptionWord[] = [];
    let offsetFrames = 0;
    segments.forEach((seg, i) => {
      const c = clips.find((x) => url(x.file) === seg.src)!;
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
    const props: ClipEditProps = {
      segments,
      transition,
      captions: {
        words: req.captions && plan.showCaptions ? words : [],
        style: req.captions && plan.showCaptions ? s.captions.onVideoStyle : "none",
        language: telugu ? "telugu" : "english",
      },
      hook: plan.hook.trim() || undefined,
      brand: await brandProps(ctx, url),
      keepAudio: hasVoice,
      preset: "night",
    };

    await checkCancelled(ctx);
    await ctx.update({ stage: "Rendering the edit", progress: 0.4 });
    const slug = safeName(plan.title || "edit");
    const master = path.join(ctx.work, `${slug}-master.mp4`);
    const duration = await renderClipEdit(props, master, (p) => {
      void ctx.update({ progress: 0.4 + 0.45 * p }).catch(() => undefined);
    });
    const cover = path.join(ctx.work, `${slug}-cover.jpg`);
    await ffmpeg(["-ss", Math.min(1.5, duration / 3).toFixed(2), "-i", master, "-frames:v", "1", "-q:v", "3", cover]);
    await ctx.update({ stage: "Adding music versions and uploading", progress: 0.88 });
    const folderId = await ctx.store.outputFolder(today(s.auto.timezone), ctx.job.id);
    const out = await deliverReel(ctx, {
      master,
      duration,
      cover,
      slug,
      title: plan.title,
      caption: plan.caption,
      hashtags: plan.hashtags,
      mood: plan.mood,
      hasVoice,
      folderId,
      needsReview: telugu && props.captions.words.length > 0,
      reviewNote:
        telugu && props.captions.words.length > 0
          ? "Telugu captions come from automatic speech recognition and may have mistakes. Watch before posting."
          : undefined,
    });
    return [out];
  } finally {
    unmount(ctx.job.id);
  }
}
