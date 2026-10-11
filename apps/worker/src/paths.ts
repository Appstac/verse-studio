import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Everything the worker keeps on the machine lives in ~/.verse-studio
// (C:\Users\<name>\.verse-studio on Windows).
export function dataDir(): string {
  const dir = process.env.VERSE_STUDIO_HOME || path.join(os.homedir(), ".verse-studio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sub(...parts: string[]): string {
  const dir = path.join(dataDir(), ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
