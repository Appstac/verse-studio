// "Virtual green screen": separates the person from the room in every frame with
// Robust Video Matting (runs locally on the CPU), then puts them on a new background.
// The model keeps memory between frames, so edges stay steady instead of flickering.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log";
import { FFMPEG, ffmpeg, probe } from "./media";
import { sub } from "./paths";

const MODEL_URL = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx";
const MODEL_BYTES = 14975696;

type Ort = typeof import("onnxruntime-node");
let ortPromise: Promise<Ort> | null = null;
function loadOrt(): Promise<Ort> {
  if (!ortPromise) ortPromise = import("onnxruntime-node").then((m) => ((m as unknown as { default?: Ort }).default ?? m) as Ort);
  return ortPromise;
}

async function modelPath(): Promise<string> {
  const f = path.join(sub("models"), "rvm_mobilenetv3_fp32.onnx");
  if (fs.existsSync(f) && fs.statSync(f).size === MODEL_BYTES) return f;
  log("Downloading the background-removal model (15 MB, once)...");
  const r = await fetch(MODEL_URL);
  if (!r.ok) throw new Error(`Couldn't download the background-removal model (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(`${f}.tmp`, buf);
  fs.renameSync(`${f}.tmp`, f);
  return f;
}

export async function mattingAvailable(): Promise<boolean> {
  try {
    await loadOrt();
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a greyscale matte video (white = person) the same length as `input`.
 * Frames are analysed at ~540px wide for speed; the matte is scaled back up when compositing.
 */
export async function makeMatte(input: string, output: string, onProgress?: (p: number) => void): Promise<void> {
  const ort = await loadOrt();
  const session = await ort.InferenceSession.create(await modelPath(), {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  const info = await probe(input);
  const scale = Math.min(1, 540 / Math.min(info.width, info.height));
  const w = Math.max(64, Math.round((info.width * scale) / 2) * 2);
  const h = Math.max(64, Math.round((info.height * scale) / 2) * 2);
  const frameBytes = w * h * 3;
  const totalFrames = Math.max(1, Math.round(info.duration * 30));

  const dec = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", input, "-vf", `scale=${w}:${h}:flags=bilinear,fps=30`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], {
    windowsHide: true,
  });
  const enc = spawn(
    FFMPEG,
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${w}x${h}`, "-r", "30", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", output],
    { windowsHide: true },
  );
  let encErr = "";
  enc.stderr.on("data", (d) => (encErr += d));
  const encDone = new Promise<void>((ok, bad) => enc.on("close", (c) => (c === 0 ? ok() : bad(new Error(`matte encoding failed: ${encErr.slice(-300)}`)))));

  // Recurrent state: starts empty, then carries over frame to frame.
  const zero = () => new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
  let rec = [zero(), zero(), zero(), zero()];
  const ratio = new ort.Tensor("float32", new Float32Array([Math.min(1, 384 / Math.max(w, h))]), [1]);
  const src = new Float32Array(3 * w * h);
  const gray = Buffer.alloc(w * h);

  let pending: Buffer = Buffer.alloc(0);
  let frames = 0;
  const writeOut = (b: Buffer) => new Promise<void>((ok) => (enc.stdin.write(b) ? ok() : enc.stdin.once("drain", () => ok())));

  for await (const chunk of dec.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
    while (pending.length >= frameBytes) {
      const frame = pending.subarray(0, frameBytes);
      const plane = w * h;
      for (let i = 0, p = 0; i < plane; i++, p += 3) {
        src[i] = frame[p] / 255;
        src[plane + i] = frame[p + 1] / 255;
        src[2 * plane + i] = frame[p + 2] / 255;
      }
      const out = await session.run({
        src: new ort.Tensor("float32", src, [1, 3, h, w]),
        r1i: rec[0],
        r2i: rec[1],
        r3i: rec[2],
        r4i: rec[3],
        downsample_ratio: ratio,
      });
      rec = [out.r1o, out.r2o, out.r3o, out.r4o] as typeof rec;
      const pha = out.pha.data as Float32Array;
      for (let i = 0; i < plane; i++) gray[i] = Math.max(0, Math.min(255, Math.round(pha[i] * 255)));
      await writeOut(gray);
      pending = pending.subarray(frameBytes);
      frames++;
      if (frames % 15 === 0) onProgress?.(Math.min(1, frames / totalFrames));
    }
  }
  enc.stdin.end();
  await encDone;
  if (frames === 0) throw new Error("No frames could be read for background removal.");
}

export type BackgroundSource =
  | { kind: "blur" }
  | { kind: "color"; color: string }
  | { kind: "video"; file: string; blur?: number }
  | { kind: "image"; file: string; blur?: number };

export interface FinishOptions {
  /** Studio key light on the face + rim light in the backdrop's colour + colour match. */
  relight: boolean;
  /**
   * Virtual set: put the person on a backdrop of this size (the output shape) instead of
   * the source's shape, e.g. a vertical phone video on a horizontal YouTube set.
   */
  canvas?: { width: number; height: number };
  crf: number;
  preset: string;
}

/** Reads one small RGB frame of an image/video (or a still colour) for light analysis. */
async function sampleRgb(bg: BackgroundSource | null, fallback: string, w = 48, h = 27): Promise<Uint8Array> {
  const src = bg && (bg.kind === "image" || bg.kind === "video") ? bg.file : fallback;
  if (bg?.kind === "color") {
    const hex = bg.color.replace("#", "");
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
    return Uint8Array.from({ length: w * h * 3 }, (_, i) => rgb[i % 3]);
  }
  const out = await new Promise<Buffer>((ok, bad) => {
    const ch = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", src, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { windowsHide: true });
    const parts: Buffer[] = [];
    ch.stdout.on("data", (d) => parts.push(d));
    ch.on("close", (c) => (c === 0 ? ok(Buffer.concat(parts)) : bad(new Error("sample failed"))));
    ch.on("error", bad);
  });
  return new Uint8Array(out);
}

/** The scene's ambient colour and the colour of its brightest lights. */
function lightOf(px: Uint8Array) {
  const n = px.length / 3;
  const lum: Array<{ l: number; i: number }> = [];
  const avg = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const r = px[i * 3];
    const g = px[i * 3 + 1];
    const b = px[i * 3 + 2];
    avg[0] += r;
    avg[1] += g;
    avg[2] += b;
    lum.push({ l: 0.2126 * r + 0.7152 * g + 0.0722 * b, i });
  }
  avg.forEach((_, k) => (avg[k] /= n));
  lum.sort((x, y) => y.l - x.l);
  const top = lum.slice(0, Math.max(1, Math.round(n * 0.12)));
  const light = [0, 0, 0];
  for (const t of top) for (let k = 0; k < 3; k++) light[k] += px[t.i * 3 + k] / top.length;
  // Lift the light colour so a rim light reads as light, not as a tint.
  const m = Math.max(...light, 1);
  const lift = light.map((c) => Math.round(Math.min(255, (c / m) * 255 * 0.85 + 40)));
  const hex = `#${lift.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  return { ambient: avg, lightHex: hex, brightness: avg.reduce((x, y) => x + y, 0) / 3 / 255 };
}

/** Where the person's head is (0-1 of the frame), from a few frames of the matte. */
async function headPosition(matte: string, duration: number): Promise<{ x: number; y: number; width: number }> {
  const w = 64;
  const h = 114;
  const times = [0.15, 0.35, 0.55, 0.75, 0.9].map((t) => Math.max(0, duration * t));
  const found: Array<{ x: number; y: number; width: number }> = [];
  for (const t of times) {
    const buf = await new Promise<Buffer>((ok) => {
      const ch = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", matte, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-pix_fmt", "gray", "-f", "rawvideo", "-"], { windowsHide: true });
      const parts: Buffer[] = [];
      ch.stdout.on("data", (d) => parts.push(d));
      ch.on("close", () => ok(Buffer.concat(parts)));
      ch.on("error", () => ok(Buffer.alloc(0)));
    });
    if (buf.length < w * h) continue;
    let top = -1;
    for (let y = 0; y < h && top < 0; y++) {
      let c = 0;
      for (let x = 0; x < w; x++) if (buf[y * w + x] > 128) c++;
      if (c > w * 0.04) top = y;
    }
    if (top < 0) continue;
    let sx = 0;
    let n = 0;
    let minX = w;
    let maxX = 0;
    for (let y = top; y < Math.min(h, top + h * 0.12); y++)
      for (let x = 0; x < w; x++)
        if (buf[y * w + x] > 128) {
          sx += x;
          n++;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
    if (n) found.push({ x: sx / n / w, y: Math.min(0.9, (top + h * 0.08) / h), width: Math.max(0.1, (maxX - minX + 1) / w) });
  }
  if (!found.length) return { x: 0.5, y: 0.3, width: 0.3 };
  const avg = (k: "x" | "y" | "width") => found.reduce((s2, f) => s2 + f[k], 0) / found.length;
  return { x: avg("x"), y: avg("y"), width: avg("width") };
}

/**
 * Finishes the person: optional new background, studio relighting, clean-up and
 * sharpening, at full resolution. bg = null keeps the real room (slightly darker,
 * so the lit speaker stands out). Output keeps the input's size, rate and sound.
 */
export async function finishSubject(input: string, matte: string, bg: BackgroundSource | null, output: string, opts: FinishOptions): Promise<void> {
  const info = await probe(input);
  const SW = info.width;
  const SH = info.height;
  const onSet = !!bg && !!opts.canvas && Math.abs(opts.canvas.width / opts.canvas.height - SW / SH) > 0.1;
  // Output size: the set, or the source.
  const W = onSet ? opts.canvas!.width : SW;
  const H = onSet ? opts.canvas!.height : SH;
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
  const args: string[] = ["-i", input, "-i", matte];
  const graph: string[] = [`[0:v]format=yuv420p,split=2[src][room]`];

  // Background
  let replaced = true;
  if (!bg) {
    replaced = false;
    graph.push(`[room]eq=brightness=-0.045:saturation=0.92,vignette=angle=PI/4.5[bg]`);
  } else if (bg.kind === "blur") {
    graph.push(`[room]scale=iw/4:ih/4,gblur=sigma=12,${cover},eq=brightness=-0.04:saturation=0.9[bg]`);
  } else if (bg.kind === "color") {
    args.push("-f", "lavfi", "-i", `color=c=${bg.color.replace("#", "0x")}:s=${W}x${H}:r=30`);
    graph.push(`[room]nullsink`, `[2:v]format=yuv420p[bg]`);
  } else if (bg.kind === "image") {
    // A photo: soft camera blur, and a very slow drift so it doesn't feel frozen.
    args.push("-loop", "1", "-framerate", "30", "-i", bg.file);
    const blur = bg.blur ? `,gblur=sigma=${bg.blur}` : "";
    graph.push(`[room]nullsink`, `[2:v]${cover}${blur},scale=${Math.round(W * 1.06 / 2) * 2}:${Math.round(H * 1.06 / 2) * 2},crop=${W}:${H}:'(iw-ow)/2+(iw-ow)/2*sin(t/9)':'(ih-oh)/2',format=yuv420p[bg]`);
  } else {
    args.push("-stream_loop", "-1", "-i", bg.file);
    const blur = bg.blur ? `,gblur=sigma=${bg.blur}` : "";
    graph.push(`[room]nullsink`, `[2:v]${cover},fps=30${blur},format=yuv420p[bg]`);
  }

  // Matte: full size, edges feathered a touch so hair doesn't look cut out.
  graph.push(`[1:v]scale=${SW}:${SH}:flags=bicubic,format=gray,gblur=sigma=1.3,split=3[m][ms][mr]`);

  // The person: denoise, gentle sharpening, a little contrast.
  graph.push(`[src]hqdn3d=1.2:1.2:4:4,unsharp=5:5:0.45:5:5:0,eq=contrast=1.04:saturation=1.03[fg0]`);

  if (opts.relight) {
    const scene = lightOf(await sampleRgb(bg && bg.kind !== "blur" ? bg : null, input));
    const head = await headPosition(matte, info.duration);
    // Colour match: nudge the person's midtones a little toward the scene's ambient colour.
    const mean = (scene.ambient[0] + scene.ambient[1] + scene.ambient[2]) / 3 || 1;
    const shift = scene.ambient.map((c) => Math.max(-0.05, Math.min(0.05, (c / mean - 1) * 0.07)));
    graph.push(`[fg0]colorbalance=rm=${shift[0].toFixed(3)}:gm=${shift[1].toFixed(3)}:bm=${shift[2].toFixed(3)},split=3[fgA][fgB][fgC]`);
    // Key light: a soft, warm pool of light on the face.
    const lw = Math.max(32, Math.round(SW / 8));
    const lh = Math.max(32, Math.round(SH / 8));
    const cx = (head.x * lw).toFixed(1);
    const cy = (head.y * lh).toFixed(1);
    const sx = Math.max(4, head.width * lw * 1.4).toFixed(1);
    const sy = Math.max(4, head.width * lw * 1.9).toFixed(1);
    const keyGain = scene.brightness < 0.25 ? 0.07 : 0.05;
    graph.push(`color=c=black:s=${lw}x${lh}:r=30,format=gray,geq=lum='235*exp(-(pow((X-${cx})/${sx},2)+pow((Y-${cy})/${sy},2)))',scale=${SW}:${SH}:flags=bicubic[key]`);
    graph.push(`[fgB]eq=brightness=${keyGain}:gamma=1.08,colorbalance=rm=0.025:bm=-0.02[fgL]`);
    graph.push(`[fgL][key]alphamerge[fgLa]`, `[fgA][fgLa]overlay=shortest=1[fgK]`);
    // Rim light: a thin glow along the inside edge of the person, in the scene's light colour.
    graph.push(`[mr]split=2[mr1][mr2]`, `[mr2]gblur=sigma=${Math.max(4, Math.round(Math.min(W, H) / 160))}[mrb]`);
    graph.push(`[mr1][mrb]blend=all_mode=subtract,lutyuv=y='min(255,val*${replaced ? 2.2 : 1.6})'[rim]`);
    graph.push(`color=c=${scene.lightHex.replace("#", "0x")}:s=${SW}x${SH}:r=30,format=yuv420p[rc]`);
    graph.push(`[fgC][rc]blend=all_mode=screen:shortest=1,format=yuv420p[fgS]`);
    graph.push(`[fgS][rim]alphamerge[fgSa]`, `[fgK][fgSa]overlay=shortest=1[fg]`);
  } else {
    graph.push(`[mr]nullsink`, `[fg0]null[fg]`);
  }

  // On a virtual set the person is scaled to the set's height and stands in the middle,
  // feet/body running off the bottom like a real camera shot.
  const scale = onSet ? Math.min(1.25, (H * 1.02) / SH) : 1;
  const PW = Math.round((SW * scale) / 2) * 2;
  const PH = Math.round((SH * scale) / 2) * 2;
  const px = Math.round((W - PW) / 2);
  const py = Math.max(0, H - PH);
  const fit = onSet ? `,scale=${PW}:${PH}:flags=lanczos` : "";
  // Contact shadow behind the person when they're on a new background.
  if (replaced) {
    graph.push(`[ms]gblur=sigma=28,lutyuv=y=val*0.45${fit}[shadowmask]`);
    graph.push(`color=c=black:s=${PW}x${PH}:r=30[blk]`, `[blk][shadowmask]alphamerge[shadow]`, `[bg][shadow]overlay=x=${px + 10}:y=${py + 18}:shortest=1[bgs]`);
  } else {
    graph.push(`[ms]nullsink`, `[bg]null[bgs]`);
  }
  graph.push(`[fg]format=yuv420p${fit}[fgf]`, `[m]null${fit}[mf]`, `[fgf][mf]alphamerge[fga]`, `[bgs][fga]overlay=x=${px}:y=${py}:shortest=1:format=auto,format=yuv420p[v]`);

  await ffmpeg([
    ...args,
    "-filter_complex", graph.join(";"),
    "-map", "[v]", "-map", "0:a?",
    "-t", info.duration.toFixed(3),
    "-c:v", "libx264", "-preset", opts.preset, "-crf", String(opts.crf), "-g", "30",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ]);
}
