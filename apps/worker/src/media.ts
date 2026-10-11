import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const FFMPEG: string = process.env.FFMPEG_PATH || (require("ffmpeg-static") as string);
export const FFPROBE: string = process.env.FFPROBE_PATH || (require("ffprobe-static") as { path: string }).path;

export function run(bin: string, args: string[], timeoutMs = 30 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
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

export const ffmpeg = (args: string[]) => run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args]);

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
// H.264 30fps file the renderer can seek reliably.
export async function normalizeVideo(input: string, output: string) {
  await ffmpeg([
    "-i", input,
    "-vf", "scale='if(gte(iw,ih),trunc(min(1920,iw)/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(1920,ih)/2)*2)':flags=lanczos,fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    output,
  ]);
  return output;
}

export async function extractWav(input: string, output: string) {
  await ffmpeg(["-i", input, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output]);
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
