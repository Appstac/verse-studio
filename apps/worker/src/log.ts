import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

let stream: fs.WriteStream | null = null;

export function log(...parts: unknown[]) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}`;
  console.log(line);
  try {
    if (!stream) stream = fs.createWriteStream(path.join(dataDir(), "worker.log"), { flags: "a" });
    stream.write(line + "\n");
  } catch {
    /* logging must never crash the worker */
  }
}
