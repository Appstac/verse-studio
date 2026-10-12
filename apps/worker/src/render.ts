import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipEditProps, SlideProps, VerseReelProps } from "../remotion/types";
import { log } from "./log";
import { sub } from "./paths";

const here = path.dirname(fileURLToPath(import.meta.url));
let serveUrl: Promise<string> | null = null;

// The templates are bundled once per code version and kept on disk, so a restart
// (or an update that doesn't touch the templates) doesn't re-bundle (about 2 minutes).
function templatesHash(): string {
  const h = crypto.createHash("sha1");
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(tsx?|css|json)$/.test(e.name)) h.update(e.name).update(fs.readFileSync(f));
    }
  };
  walk(path.join(here, "..", "remotion"));
  h.update(fs.readFileSync(path.join(here, "..", "..", "..", "shared", "backdrops.ts")));
  try {
    h.update(fs.readFileSync(path.join(here, "..", "package.json")));
  } catch {
    /* ignore */
  }
  return h.digest("hex").slice(0, 12);
}

function getServeUrl(): Promise<string> {
  if (!serveUrl) {
    serveUrl = (async () => {
      const dir = path.join(sub("bundle"), templatesHash());
      if (fs.existsSync(path.join(dir, "index.html"))) return dir;
      log("Preparing video templates (once per update, about a minute)...");
      const tmp = `${dir}-tmp-${process.pid}`;
      await bundle({ entryPoint: path.join(here, "..", "remotion", "index.ts"), outDir: tmp });
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      // Keep only the newest two bundles.
      const all = fs
        .readdirSync(sub("bundle"))
        .map((n) => ({ n, t: fs.statSync(path.join(sub("bundle"), n)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const old of all.slice(2)) fs.rmSync(path.join(sub("bundle"), old.n), { recursive: true, force: true });
      return dir;
    })();
    serveUrl.catch(() => (serveUrl = null));
  }
  return serveUrl;
}

/** Bundles templates and downloads the renderer's browser in the background at start-up. */
export function warmUpRenderer() {
  void prepareBrowser()
    .then(() => getServeUrl())
    .then(() => log("Video templates ready."))
    .catch((e) => log("Renderer warm-up failed (will retry on first job):", e instanceof Error ? e.message : String(e)));
}

const browserExecutable = process.env.REMOTION_BROWSER || null;
let browserReady: Promise<unknown> | null = null;
function prepareBrowser() {
  if (browserExecutable) return Promise.resolve();
  if (!browserReady) browserReady = ensureBrowser();
  return browserReady;
}

const cores = os.availableParallelism?.() ?? os.cpus().length;
const concurrency = Math.max(2, Math.min(8, cores - 1));

export interface RenderQuality {
  crf: number;
  preset: string;
  scale: number;
}
const DEFAULT_Q: RenderQuality = { crf: 18, preset: "veryfast", scale: 1 };

async function renderVideo(id: string, inputProps: Record<string, unknown>, out: string, onProgress?: (p: number) => void, q: RenderQuality = DEFAULT_Q) {
  await prepareBrowser();
  const url = await getServeUrl();
  const composition = await selectComposition({ serveUrl: url, id, inputProps, browserExecutable });
  await renderMedia({
    composition,
    serveUrl: url,
    codec: "h264",
    outputLocation: out,
    inputProps,
    browserExecutable,
    concurrency,
    crf: q.crf,
    x264Preset: q.preset as "veryfast",
    // Ultra HD: the whole frame (text, graphics, video) is drawn at 2x, i.e. 4K.
    scale: q.scale,
    videoBitrate: null,
    offthreadVideoThreads: Math.min(4, Math.max(2, Math.floor(cores / 2))),
    pixelFormat: "yuv420p",
    audioBitrate: "192k",
    imageFormat: "jpeg",
    jpegQuality: 92,
    timeoutInMilliseconds: 120000,
    onProgress: ({ progress }) => onProgress?.(progress),
  });
  return composition.durationInFrames / composition.fps;
}

export function renderVerseReel(props: VerseReelProps, out: string, onProgress?: (p: number) => void, q?: RenderQuality) {
  return renderVideo("VerseReel", props as unknown as Record<string, unknown>, out, onProgress, q);
}

export function renderClipEdit(props: ClipEditProps, out: string, onProgress?: (p: number) => void, q?: RenderQuality) {
  return renderVideo("ClipEdit", props as unknown as Record<string, unknown>, out, onProgress, q);
}

export async function renderSlide(props: SlideProps, out: string) {
  await prepareBrowser();
  const url = await getServeUrl();
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl: url, id: "Slide", inputProps, browserExecutable });
  await renderStill({ composition, serveUrl: url, output: out, inputProps, browserExecutable, imageFormat: "png" });
}

export async function renderCover(props: VerseReelProps, out: string, atSeconds: number) {
  await prepareBrowser();
  const url = await getServeUrl();
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl: url, id: "VerseReel", inputProps, browserExecutable });
  const frame = Math.min(composition.durationInFrames - 1, Math.round(atSeconds * composition.fps));
  await renderStill({
    composition,
    serveUrl: url,
    output: out,
    inputProps,
    browserExecutable,
    frame,
    imageFormat: "jpeg",
    jpegQuality: 90,
  });
}

/** Renders a looping 8-second backdrop video once and keeps it (worship studio presets). */
export async function renderBackdrop(light: string, palette: string, format: "reel" | "youtube" = "reel"): Promise<string> {
  const out = path.join(sub("backdrops"), `${light}-${palette}-${format}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 10000) return out;
  await prepareBrowser();
  const url = await getServeUrl();
  const inputProps = { light, palette, format };
  const composition = await selectComposition({ serveUrl: url, id: "Backdrop", inputProps, browserExecutable });
  const tmp = `${out}.tmp.mp4`;
  await renderMedia({ composition, serveUrl: url, codec: "h264", outputLocation: tmp, inputProps, browserExecutable, concurrency, crf: 20, x264Preset: "veryfast", muted: true, imageFormat: "jpeg", jpegQuality: 90 });
  fs.renameSync(tmp, out);
  return out;
}

/** Small preview pictures of backdrops (used to build the website's picker). */
export async function renderBackdropStill(light: string, palette: string, out: string, frame = 70, format: "reel" | "youtube" = "reel") {
  await prepareBrowser();
  const url = await getServeUrl();
  const inputProps = { light, palette, atFrame: frame, format };
  const composition = await selectComposition({ serveUrl: url, id: "BackdropStill", inputProps, browserExecutable });
  await renderStill({ composition, serveUrl: url, output: out, inputProps, browserExecutable, frame: 0, scale: 0.25, imageFormat: "jpeg", jpegQuality: 78 });
}
