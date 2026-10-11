// Local speech-to-text with whisper.cpp (free, runs on this computer).
import { downloadWhisperModel, installWhisperCpp, transcribe } from "@remotion/install-whisper-cpp";
import os from "node:os";
import path from "node:path";
import type { CaptionWord } from "../remotion/types";
import { log } from "./log";
import { sub } from "./paths";

const VERSION = "1.5.5";
type Model = "base" | "small" | "medium" | "large-v3-turbo";

async function ready(model: Model) {
  const dir = path.join(sub("whisper"), "whisper.cpp");
  await installWhisperCpp({ version: VERSION, to: dir, printOutput: false });
  const models = sub("whisper", "models");
  await downloadWhisperModel({ model, folder: models, printOutput: false });
  return { dir, models };
}

export async function prepareWhisper(model: Model) {
  log(`Preparing speech-to-text (${model} model)...`);
  await ready(model);
}

export interface Transcript {
  language: string;
  words: CaptionWord[];
  text: string;
}

export async function transcribeWav(wav: string, model: Model, language: "auto" | "en" | "te"): Promise<Transcript> {
  const { dir, models } = await ready(model);
  const res = await transcribe({
    inputPath: wav,
    whisperPath: dir,
    whisperCppVersion: VERSION,
    model,
    modelFolder: models,
    tokenLevelTimestamps: false,
    splitOnWord: true,
    tokensPerItem: 1,
    language: language === "auto" ? "auto" : language,
    printOutput: false,
    // whisper.cpp defaults to 4 threads; use the whole machine minus one core.
    additionalArgs: [["--threads", String(threads())]],
  });
  const words: CaptionWord[] = [];
  for (const item of res.transcription) {
    const text = item.text.trim();
    if (!text || /^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) continue;
    words.push({ text, startMs: item.offsets.from, endMs: Math.max(item.offsets.to, item.offsets.from + 80) });
  }
  return { language: res.result.language, words, text: words.map((w) => w.text).join(" ") };
}

function threads() {
  const n = os.availableParallelism?.() ?? os.cpus().length;
  return Math.max(2, Math.min(12, n - 1));
}
