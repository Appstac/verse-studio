import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const FFMPEG: string = process.env.FFMPEG_PATH || (require("ffmpeg-static") as string);
export const FFPROBE: string = process.env.FFPROBE_PATH || (require("ffprobe-static") as { path: string }).path;

export function run(bin: string, args: string[], timeoutMs = 30 * 60 * 1000, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, cwd });
    let out = "";
    let err = "";
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(bin)} failed (${code}): ${err.slice(-800)}`));
    });
  });
}

export const ffmpeg = (args: string[], cwd?: string) => run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], 60 * 60 * 1000, cwd);

export interface ProbeInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  isImage: boolean;
  rotation: number;
}

export async function probe(file: string): Promise<ProbeInfo> {
  const out = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  const j = JSON.parse(out) as {
    streams: Array<{ codec_type: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }> }>;
    format: { duration?: string; format_name?: string };
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  const rotation = Number(v?.tags?.rotate ?? v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0);
  let w = v?.width ?? 0;
  let h = v?.height ?? 0;
  if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) [w, h] = [h, w];
  const isImage = /image2|png_pipe|jpeg_pipe|webp_pipe|mjpeg/.test(j.format.format_name ?? "") || !j.format.duration;
  return {
    duration: Number(j.format.duration ?? 0),
    width: w,
    height: h,
    hasAudio: j.streams.some((s) => s.codec_type === "audio"),
    isImage,
    rotation,
  };
}

// Converts any phone video (HEVC, variable frame rate, rotated) into a clean
// H.264 30fps file the renderer can seek reliably. Optionally steadies shaky
// footage and cleans up the sound on the way.
export interface NormalizeOptions {
  /** Only process this part of the input (seconds). */
  start?: number;
  length?: number;
  stabilize?: "auto" | "on" | "off";
  cleanAudio?: boolean;
  workDir?: string;
  onStage?: (msg: string) => void;
}

const SCALE = "scale='if(gte(iw,ih),trunc(min(1920,iw)/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(1920,ih)/2)*2)':flags=lanczos";

// Gentle voice/singing cleanup: rumble and hiss out, a little presence, evened-out dynamics.
// Loudness is set later per version (loudnorm), so this doesn't touch the overall level much.
export const CLEAN_AUDIO =
  "highpass=f=75,lowpass=f=15500,afftdn=nr=8:nf=-42:tn=1,equalizer=f=250:t=q:w=1:g=-1.5,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=-21dB:ratio=2.5:attack=12:release=220:makeup=1.5";

export async function normalizeVideo(input: string, output: string, opts: NormalizeOptions = {}) {
  const audio = opts.cleanAudio ? ["-af", CLEAN_AUDIO] : [];
  let vf = `${SCALE},fps=30,format=yuv420p`;
  const mode = opts.stabilize ?? "off";
  const seek = [...(opts.start ? ["-ss", opts.start.toFixed(3)] : []), ...(opts.length ? ["-t", opts.length.toFixed(3)] : [])];
  if (mode !== "off" && opts.workDir) {
    const st = await planStabilization(input, opts.workDir, mode, opts.onStage, seek).catch(() => null);
    if (st) vf = `${st},${vf}`;
  }
  await ffmpeg(
    [
      ...seek,
      "-i", input,
      "-vf", vf,
      ...audio,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      output,
    ],
    opts.workDir,
  );
  return output;
}

let filtersCache: string | null = null;
async function hasFilter(name: string) {
  if (filtersCache === null) filtersCache = await run(FFMPEG, ["-hide_banner", "-filters"]).catch(() => "");
  return new RegExp(`\\s${name}\\s`).test(filtersCache);
}

/**
 * Measures camera shake with vidstab's first pass. Returns the filter that steadies
 * it (or null when the shot is already steady and mode is "auto").
 * The transforms file is written in workDir and referenced by a relative name,
 * because Windows drive letters ("C:") break ffmpeg filter arguments.
 */
async function planStabilization(input: string, workDir: string, mode: "auto" | "on", onStage?: (m: string) => void, seek: string[] = []): Promise<string | null> {
  if (!(await hasFilter("vidstabdetect"))) return mode === "on" ? "deshake=rx=24:ry=24" : null;
  onStage?.("Checking for camera shake");
  const name = `stab-${path.basename(input).replace(/[^\w.-]/g, "_")}-${seek.join("_").replace(/[^\w.-]/g, "")}.trf`;
  const detect = (ascii: boolean) =>
    ffmpeg([...seek, "-i", input, "-vf", `${SCALE},vidstabdetect=shakiness=6:accuracy=9:stepsize=12${ascii ? ":fileformat=1" : ""}:result=${name}`, "-an", "-f", "null", "-"], workDir);
  // Text format lets us measure the shake; older vid.stab builds only write binary.
  const ascii = await detect(true).then(() => true, () => detect(false).then(() => false));
  const jitter = ascii ? shakeScore(fs.readFileSync(path.join(workDir, name), "utf8")) : mode === "on" ? 99 : 0;
  if (mode === "auto" && jitter < 2.2) return null;
  onStage?.("Steadying shaky video");
  return `vidstabtransform=input=${name}:smoothing=24:zoom=3:optzoom=0:interpol=bicubic,unsharp=5:5:0.5:3:3:0`;
}

// Average frame-to-frame wobble (pixels) after removing the intended camera move.
export function shakeScore(trf: string): number {
  const motions: Array<[number, number]> = [];
  for (const line of trf.split(/\r?\n/)) {
    if (!line.startsWith("Frame")) continue;
    const vs = [...line.matchAll(/\(LM (-?\d+) (-?\d+) /g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
    if (!vs.length) {
      motions.push([0, 0]);
      continue;
    }
    const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
    motions.push([med(vs.map((v) => v[0])), med(vs.map((v) => v[1]))]);
  }
  if (motions.length < 10) return 0;
  const k = 15;
  let sum = 0;
  for (let i = 0; i < motions.length; i++) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(motions.length - 1, i + k); j++) {
      sx += motions[j][0];
      sy += motions[j][1];
      n++;
    }
    sum += Math.hypot(motions[i][0] - sx / n, motions[i][1] - sy / n);
  }
  return sum / motions.length;
}

export async function extractWav(input: string, output: string, start = 0, length = 0) {
  const seek = [...(start ? ["-ss", start.toFixed(3)] : []), ...(length ? ["-t", length.toFixed(3)] : [])];
  await ffmpeg([...seek, "-i", input, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output]);
  return output;
}

// A 3x3 grid of frames so Claude can "see" each clip before planning the edit.
export async function contactSheet(input: string, duration: number, output: string) {
  const n = 9;
  const step = Math.max(0.5, duration / (n + 1));
  await ffmpeg([
    "-i", input,
    "-vf", `fps=1/${step.toFixed(3)},scale=360:-2,drawtext=text='%{pts\\:hms}':x=8:y=8:fontcolor=white:fontsize=22:box=1:boxcolor=black@0.6,tile=3x3`,
    "-frames:v", "1",
    output,
  ]).catch(async () => {
    // drawtext needs a font on some systems; retry without timestamps
    await ffmpeg(["-i", input, "-vf", `fps=1/${step.toFixed(3)},scale=360:-2,tile=3x3`, "-frames:v", "1", output]);
  });
  return output;
}

/**
 * Timestamped frame grids covering the whole clip (a frame every ~2-3 s, 12 per
 * sheet), so Claude can find the best moments and see who is where in the shot.
 * Returns the sheet files and the spacing between frames.
 */
export async function frameSheets(
  input: string,
  duration: number,
  outPrefix: string,
  maxFrames = 48,
  opts: { start?: number; fast?: boolean } = {},
): Promise<{ files: string[]; step: number }> {
  const frames = Math.max(6, Math.min(maxFrames, Math.ceil(duration / 2.5)));
  const step = Math.max(0.5, duration / frames);
  const perSheet = 12;
  const pattern = `${outPrefix}-%02d.jpg`;
  const vf = (label: boolean) =>
    `fps=1/${step.toFixed(3)},scale=300:-2${label ? ",drawtext=text='%{pts\\:hms}':x=6:y=6:fontcolor=white:fontsize=20:box=1:boxcolor=black@0.65" : ""},tile=4x3`;
  // fast: decode only keyframes (phones put one every ~1 s), many times quicker than decoding every frame.
  const pre = (fast: boolean) => [...(fast ? ["-skip_frame", "nokey"] : []), ...(opts.start ? ["-ss", opts.start.toFixed(3)] : []), "-t", duration.toFixed(3)];
  const label = opts.start ? `,setpts=PTS-STARTPTS` : "";
  const attempt = (fast: boolean, text: boolean) =>
    ffmpeg([...pre(fast), "-i", input, "-vf", `${label ? label.slice(1) + "," : ""}${vf(text)}`, "-vsync", "vfr", "-q:v", "4", "-start_number", "1", pattern]);
  await attempt(!!opts.fast, true)
    .catch(() => attempt(!!opts.fast, false))
    .catch(() => attempt(false, false));
  const files: string[] = [];
  for (let i = 1; i <= Math.ceil(frames / perSheet) + 1; i++) {
    const f = `${outPrefix}-${String(i).padStart(2, "0")}.jpg`;
    if (fs.existsSync(f)) files.push(f);
  }
  return { files, step };
}

export interface AudioMap {
  /** Loudness per bucket in dBFS (rounded). */
  db: number[];
  bucketSeconds: number;
  /** Stretches of sound separated by short dips: sung lines or spoken phrases. */
  phrases: Array<{ start: number; end: number }>;
  silences: Array<{ start: number; end: number }>;
}

// Reads a 16 kHz mono 16-bit WAV (from extractWav) and maps how loud it is over time.
export function audioMap(wavFile: string): AudioMap {
  const buf = fs.readFileSync(wavFile);
  let off = 12;
  let dataStart = 44;
  let dataLen = buf.length - 44;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (id === "data") {
      dataStart = off + 8;
      dataLen = Math.min(len, buf.length - dataStart);
      break;
    }
    off += 8 + len + (len % 2);
  }
  const rate = 16000;
  const n = Math.floor(dataLen / 2);
  const win = rate / 10; // 100 ms
  const rms: number[] = [];
  for (let i = 0; i + win <= n; i += win) {
    let acc = 0;
    for (let j = 0; j < win; j++) {
      const v = buf.readInt16LE(dataStart + (i + j) * 2) / 32768;
      acc += v * v;
    }
    rms.push(20 * Math.log10(Math.sqrt(acc / win) + 1e-6));
  }
  const seconds = rms.length / 10;
  const bucketSeconds = seconds > 240 ? 5 : seconds > 120 ? 2 : 1;
  const per = bucketSeconds * 10;
  const db: number[] = [];
  for (let i = 0; i < rms.length; i += per) {
    const sl = rms.slice(i, i + per);
    db.push(Math.round(10 * Math.log10(sl.reduce((a, x) => a + 10 ** (x / 10), 0) / sl.length)));
  }
  // Phrases: smooth, then threshold halfway between the quiet floor and the loud level.
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? -60;
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? -20;
  const thr = floor + (loud - floor) * 0.45;
  const smooth = rms.map((_, i) => {
    const a = rms.slice(Math.max(0, i - 1), i + 2);
    return a.reduce((x, y) => x + y, 0) / a.length;
  });
  const phrases: AudioMap["phrases"] = [];
  const silences: AudioMap["silences"] = [];
  let st = -1;
  for (let i = 0; i <= smooth.length; i++) {
    const on = i < smooth.length && smooth[i] > thr;
    if (on && st < 0) st = i;
    if (!on && st >= 0) {
      const last = phrases[phrases.length - 1];
      if (last && st / 10 - last.end < 0.35) last.end = i / 10;
      else phrases.push({ start: st / 10, end: i / 10 });
      st = -1;
    }
  }
  const real = phrases.filter((p) => p.end - p.start >= 0.4);
  let prev = 0;
  for (const p of real) {
    if (p.start - prev >= 1) silences.push({ start: prev, end: p.start });
    prev = p.end;
  }
  if (seconds - prev >= 1) silences.push({ start: prev, end: seconds });
  return { db, bucketSeconds, phrases: real.slice(0, 200), silences: silences.slice(0, 100) };
}

export function describeAudioMap(m: AudioMap): string {
  const bars = "▁▂▃▄▅▆▇█";
  const min = Math.min(...m.db);
  const max = Math.max(...m.db);
  const graph = m.db.map((d) => bars[Math.round(((d - min) / Math.max(1, max - min)) * 7)]).join("");
  const f = (x: number) => x.toFixed(1);
  return [
    `Loudness, one bar per ${m.bucketSeconds}s from 0s (quiet ▁ to loud █, ${min} to ${max} dBFS): ${graph}`,
    `Sound phrases (sung lines / spoken sentences, seconds): ${m.phrases.map((p) => `${f(p.start)}-${f(p.end)}`).join(", ") || "none"}`,
    `Near-silent gaps of 1s or more: ${m.silences.map((p) => `${f(p.start)}-${f(p.end)}`).join(", ") || "none"}`,
  ].join("\n  ");
}

export interface PictureStats {
  brightness: number; // 0-1 average luma
  clippedHighlights: number; // share of very bright pixels, 0-1
  darkShare: number; // share of very dark pixels, 0-1
  warmth: number; // >0 warm, <0 cool (Cr-Cb balance)
  saturation: number; // 0-1
}

// Samples a frame every few seconds and measures exposure and colour.
export async function pictureStats(input: string, duration: number, start = 0): Promise<PictureStats | null> {
  try {
    const step = Math.max(1, duration / 12);
    const out = await run(FFMPEG, [
      "-hide_banner", "-loglevel", "error",
      "-skip_frame", "nokey",
      ...(start ? ["-ss", start.toFixed(3)] : []),
      "-t", duration.toFixed(3),
      "-i", input,
      "-vf", `fps=1/${step.toFixed(2)},scale=240:-2,signalstats=stat=brng,metadata=mode=print:file=-`,
      "-an", "-f", "null", "-",
    ]);
    const vals = (k: string) => [...out.matchAll(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`, "g"))].map((m) => Number(m[1]));
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    const yavg = avg(vals("YAVG"));
    if (!Number.isFinite(yavg)) return null;
    const yhigh = avg(vals("YHIGH"));
    const ylow = avg(vals("YLOW"));
    const u = avg(vals("UAVG"));
    const v = avg(vals("VAVG"));
    const sat = avg(vals("SATAVG"));
    return {
      brightness: +(yavg / 255).toFixed(2),
      clippedHighlights: +Math.max(0, (yhigh - 235) / 20).toFixed(2),
      darkShare: +Math.max(0, (30 - ylow) / 30).toFixed(2),
      warmth: +((v - 128 - (u - 128)) / 40).toFixed(2),
      saturation: +(sat / 128).toFixed(2),
    };
  } catch {
    return null;
  }
}

export async function loudnessNormalize(input: string, output: string) {
  await ffmpeg(["-i", input, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", output]);
  return output;
}

export type MixMode = "silent" | "music" | "music-under-voice" | "original";

// Makes one audio version of a rendered video without re-rendering the picture.
export async function makeVariant(opts: {
  video: string;
  out: string;
  mode: MixMode;
  music?: string;
  duration: number;
  musicVolume: number;
  fade: number;
}) {
  const { video, out, mode, music, duration, musicVolume, fade } = opts;
  const fadeOutStart = Math.max(0, duration - fade).toFixed(2);
  if (mode === "silent") {
    await ffmpeg(["-i", video, "-c:v", "copy", "-an", "-movflags", "+faststart", out]);
    return out;
  }
  if (mode === "original") {
    await ffmpeg([
      "-i", video, "-c:v", "copy",
      "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-movflags", "+faststart", out,
    ]);
    return out;
  }
  if (!music) throw new Error("No music track available");
  const musicChain = `[1:a]aloop=loop=-1:size=2e9,atrim=0:${duration.toFixed(2)},asetpts=N/SR/TB,volume=${musicVolume.toFixed(2)},afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOutStart}:d=${fade}`;
  if (mode === "music") {
    await ffmpeg([
      "-i", video, "-i", music,
      "-filter_complex", `${musicChain},loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-shortest", "-movflags", "+faststart", out,
    ]);
    return out;
  }
  // music-under-voice: duck the music whenever someone is singing/speaking
  await ffmpeg([
    "-i", video, "-i", music,
    "-filter_complex",
    `${musicChain}[m];[0:a]asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck];[v][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", out,
  ]);
  return out;
}

// Generates soft ambient pads so the "library" version works before any real
// music is added. Replace them with real royalty-free tracks in Drive.
export async function makeStarterPad(out: string, mood: string) {
  const chords: Record<string, number[][]> = {
    calm: [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 293.66]],
    uplifting: [[261.63, 329.63, 392], [196, 246.94, 392], [220, 261.63, 329.63], [174.61, 261.63, 349.23]],
    worship: [[293.66, 369.99, 440], [246.94, 293.66, 369.99], [196, 246.94, 293.66], [220, 277.18, 329.63]],
    reflective: [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]],
  };
  const prog = chords[mood] ?? chords.calm;
  const seg = 8;
  const parts = prog.map((c, i) => {
    const sines = c.map((f) => `sin(2*PI*${f}*t)+0.5*sin(2*PI*${(f / 2).toFixed(2)}*t)`).join("+");
    return `aevalsrc='0.06*(${sines})*(0.85+0.15*sin(2*PI*0.2*t))':s=48000:d=${seg}[c${i}]`;
  });
  const concat = prog.map((_, i) => `[c${i}]`).join("") + `concat=n=${prog.length}:v=0:a=1`;
  const total = seg * prog.length;
  await ffmpeg([
    "-filter_complex",
    `${parts.join(";")};${concat},lowpass=f=1800,aecho=0.8:0.85:600|1100:0.35|0.25,afade=t=in:d=2,afade=t=out:st=${total - 3}:d=3,aformat=channel_layouts=stereo[a]`,
    "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "192k", out,
  ]);
  return out;
}

export function isVideoName(n: string) {
  return /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(n);
}
export function isImageName(n: string) {
  return /\.(jpe?g|png|webp)$/i.test(n);
}
export function isAudioName(n: string) {
  return /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(n);
}

export function safeName(s: string, max = 48) {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, max)
      .toLowerCase() || "reel"
  );
}

export function rmrf(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// Soft transition sounds, generated locally so there is nothing to license.
export async function makeSfx(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const whoosh = path.join(dir, "whoosh.mp3");
  const pop = path.join(dir, "pop.mp3");
  if (!fs.existsSync(whoosh)) {
    await ffmpeg([
      "-f", "lavfi", "-i", "anoisesrc=d=0.55:c=pink:a=0.6",
      "-af", "highpass=f=400,lowpass=f=5000,afade=t=in:d=0.25,afade=t=out:st=0.28:d=0.27,volume=0.9,aformat=channel_layouts=stereo",
      "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "160k", whoosh,
    ]);
  }
  if (!fs.existsSync(pop)) {
    await ffmpeg([
      "-f", "lavfi", "-i", "sine=f=880:d=0.12",
      "-af", "volume=0.8,afade=t=out:st=0.03:d=0.09,aformat=channel_layouts=stereo",
      "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "160k", pop,
    ]);
  }
  return { whoosh, pop };
}
