// Local files shared with the Windows service scripts (scripts/*.ps1) in ~/.verse-studio:
//   control.json  { autostart, paused, appliedAt }  - the computer's own on/off state
//   alive.json    { pid, at, loopAt }                - lets the watchdog spot a frozen worker
//   update-result.json                               - written by run-worker.ps1 after an update
//   update.flag                                      - asks run-worker.ps1 to update before restarting
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Heartbeat } from "../../../shared/schema";
import { dataDir } from "./paths";

export const EXIT_RESTART = 0;
export const EXIT_ALREADY_RUNNING = 3;
export const EXIT_UPDATE = 75;

export interface LocalControl {
  autostart: boolean;
  paused: boolean;
  appliedAt?: string;
}

const file = (n: string) => path.join(dataDir(), n);

function readJson<T>(name: string): T | null {
  try {
    // PowerShell 5 writes UTF-8 with a BOM.
    return JSON.parse(fs.readFileSync(file(name), "utf8").replace(/^﻿/, "")) as T;
  } catch {
    return null;
  }
}

function writeJson(name: string, data: unknown) {
  const f = file(name);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${f}.tmp`, f);
}

export function readLocalControl(): LocalControl {
  const c = readJson<Partial<LocalControl>>("control.json") ?? {};
  return { autostart: c.autostart !== false, paused: c.paused === true, appliedAt: c.appliedAt };
}

export function writeLocalControl(c: LocalControl) {
  writeJson("control.json", c);
}

export function supervisor(): NonNullable<Heartbeat["supervisor"]> {
  const s = process.env.VERSE_STUDIO_SUPERVISOR;
  return s === "windows" || s === "launchd" ? s : "manual";
}

export function lastUpdate(): Heartbeat["lastUpdate"] {
  const u = readJson<{ at?: string; ok?: boolean; message?: string }>("update-result.json");
  return u?.at ? { at: u.at, ok: !!u.ok, message: u.message ?? "" } : undefined;
}

export function requestUpdate() {
  fs.writeFileSync(file("update.flag"), new Date().toISOString());
}

let commitCache: string | undefined | null = null;
export function gitCommit(): string | undefined {
  if (commitCache !== null) return commitCache;
  try {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8", windowsHide: true, timeout: 5000 });
    commitCache = r.status === 0 ? r.stdout.trim() || undefined : undefined;
  } catch {
    commitCache = undefined;
  }
  return commitCache;
}

// --- liveness -------------------------------------------------------------
let loopAt = new Date().toISOString();
export function markProgress() {
  loopAt = new Date().toISOString();
}

function writeAlive() {
  try {
    writeJson("alive.json", { pid: process.pid, at: new Date().toISOString(), loopAt });
  } catch {
    /* disk full or similar: the watchdog will just see an older file */
  }
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Makes sure only one worker runs on this computer. Another worker counts as
 * running only if its process exists AND it touched alive.json in the last 3 minutes,
 * so a stale file (or a reused process id) never blocks a start.
 */
export function claimSingleInstance(): { ok: true } | { ok: false; pid: number } {
  const a = readJson<{ pid?: number; at?: string }>("alive.json");
  if (a?.pid && a.pid !== process.pid && a.at && Date.now() - Date.parse(a.at) < 3 * 60_000 && pidAlive(a.pid)) {
    return { ok: false, pid: a.pid };
  }
  writeAlive();
  const t = setInterval(writeAlive, 30_000);
  t.unref();
  process.on("exit", () => {
    try {
      const cur = readJson<{ pid?: number }>("alive.json");
      if (cur?.pid === process.pid) fs.rmSync(file("alive.json"), { force: true });
    } catch {
      /* ignore */
    }
  });
  return { ok: true };
}
