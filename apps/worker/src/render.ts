import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipEditProps, SlideProps, VerseReelProps } from "../remotion/types";
import { log } from "./log";

const here = path.dirname(fileURLToPath(import.meta.url));
let serveUrl: Promise<string> | null = null;

function getServeUrl(): Promise<string> {
  if (!serveUrl) {
    log("Bundling video templates (first run takes a minute)...");
    serveUrl = bundle({ entryPoint: path.join(here, "..", "remotion", "index.ts") });
  }
  return serveUrl;
}

const browserExecutable = process.env.REMOTION_BROWSER || null;
let browserReady: Promise<unknown> | null = null;
function prepareBrowser() {
  if (browserExecutable) return Promise.resolve();
  if (!browserReady) browserReady = ensureBrowser();
  return browserReady;
}

const concurrency = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));

async function renderVideo(id: string, inputProps: Record<string, unknown>, out: string, onProgress?: (p: number) => void) {
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
    crf: 18,
    pixelFormat: "yuv420p",
    audioBitrate: "192k",
    imageFormat: "jpeg",
    jpegQuality: 92,
    timeoutInMilliseconds: 120000,
    onProgress: ({ progress }) => onProgress?.(progress),
  });
  return composition.durationInFrames / composition.fps;
}

export function renderVerseReel(props: VerseReelProps, out: string, onProgress?: (p: number) => void) {
  return renderVideo("VerseReel", props as unknown as Record<string, unknown>, out, onProgress);
}

export function renderClipEdit(props: ClipEditProps, out: string, onProgress?: (p: number) => void) {
  return renderVideo("ClipEdit", props as unknown as Record<string, unknown>, out, onProgress);
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
