// The worker loop: heartbeat, auto-mode scheduling, and job processing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Job, type Settings, WorkerControl, newJobId } from "../../../shared/schema";
import { WORKER_ID, VERSION } from "./config";
import { Cancelled, type Ctx, type Planner, runCarouselJob, runEditJob, runReviseJob, runVerseJob } from "./jobs";
import { learnIfNeeded, loadLearned, mirrorSkill } from "./learn";
import { log } from "./log";
import { makeStarterPad, rmrf } from "./media";
import { sub } from "./paths";
import type { Store } from "./store";
import {
  EXIT_RESTART,
  EXIT_UPDATE,
  type LocalControl,
  gitCommit,
  lastUpdate,
  markProgress,
  readLocalControl,
  requestUpdate,
  supervisor,
  writeLocalControl,
} from "./supervisor";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function zonedParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday };
}

export function carouselDays(perWeek: number): number[] {
  if (perWeek <= 0) return [];
  const days = new Set<number>();
  for (let i = 0; i < Math.min(7, perWeek); i++) days.add((1 + Math.round((i * 7) / Math.min(7, perWeek))) % 7);
  return [...days];
}

export class Engine {
  private busy = false;
  private current?: string;
  private nextAutoRun?: string;
  private claudeOk?: boolean;
  private control: LocalControl = readLocalControl();
  private lastError?: string;
  private intervalSeconds = 20;
  private readonly startedAt = new Date().toISOString();

  constructor(
    private store: Store,
    private ai: Planner,
    // How the worker leaves when the website asks for a restart or an update.
    private exit: (code: number) => void = (code) => process.exit(code),
  ) {}

  async start(opts: { once?: boolean } = {}) {
    await this.store.init();
    await this.recoverStuckJobs();
    await this.ensureStarterMusic();
    // The learned style guide lives in Drive, so it comes back after a restart
    // or on a new computer; refresh the local Claude Code skill copy too.
    mirrorSkill(await loadLearned(this.store));
    log(`Verse Studio worker ${VERSION} running as "${WORKER_ID}". Waiting for jobs...`);
    for (;;) {
      let settings: Settings | null = null;
      try {
        settings = await this.store.getSettings();
        this.intervalSeconds = settings.advanced.pollSeconds;
        markProgress();
        if (await this.applyControl()) return;
        if (this.control.paused) {
          this.nextAutoRun = undefined;
          await this.beat("Paused from the website");
          if (opts.once) return;
          await sleep(this.intervalSeconds * 1000);
          continue;
        }
        await this.beat();
        await this.scheduleAuto(settings);
        const ran = await this.runNext(settings);
        if (ran) continue;
        // Idle: fold any new ratings and notes into the style guide.
        await learnIfNeeded(this.store, this.ai, settings.advanced.claudeModel || undefined).catch((e) =>
          log("Learning failed (will retry):", e instanceof Error ? e.message : String(e)),
        );
        if (opts.once) return;
      } catch (e) {
        this.lastError = `${new Date().toISOString()} ${e instanceof Error ? e.message : String(e)}`;
        log("Loop error:", e instanceof Error ? e.message : String(e));
      }
      await sleep((settings?.advanced.pollSeconds ?? 20) * 1000);
    }
  }

  setClaudeOk(ok: boolean) {
    this.claudeOk = ok;
  }

  /**
   * Applies a new request from the website (State/control.json): pause/resume,
   * autostart on/off, restart, update. Returns true when the worker is leaving.
   */
  private async applyControl(): Promise<boolean> {
    // Pick up changes made on the PC itself (desktop shortcuts) too.
    this.control = readLocalControl();
    const raw = await this.store.readState<unknown>("control", null);
    const p = WorkerControl.safeParse(raw);
    if (!p.success) return false;
    const req = p.data;
    const applied = this.control.appliedAt ? Date.parse(this.control.appliedAt) : 0;
    if (!(Date.parse(req.requestedAt) > applied)) return false;
    const next: LocalControl = {
      autostart: req.autostart ?? this.control.autostart,
      paused: req.paused ?? this.control.paused,
      appliedAt: req.requestedAt,
    };
    writeLocalControl(next);
    this.control = next;
    log(`Website request: ${JSON.stringify(req)}`);
    if (req.action === "update" || req.action === "restart") {
      const sup = supervisor();
      if (sup === "manual") {
        await this.beat("Can't restart by itself: it was started by hand. Run the setup for autostart on the studio computer.");
        return false;
      }
      if (req.action === "update") requestUpdate();
      await this.beat(req.action === "update" ? "Updating to the latest version…" : "Restarting…");
      this.exit(req.action === "update" ? EXIT_UPDATE : EXIT_RESTART);
      return true;
    }
    return false;
  }

  private async beat(message?: string) {
    markProgress();
    await this.store
      .heartbeat({
        workerId: WORKER_ID,
        hostname: os.hostname(),
        platform: `${process.platform} ${os.release()}`,
        version: VERSION,
        lastSeen: new Date().toISOString(),
        busy: this.busy,
        currentJob: this.current,
        claudeOk: this.claudeOk,
        nextAutoRun: this.nextAutoRun,
        message,
        paused: this.control.paused,
        autostart: this.control.autostart,
        supervisor: supervisor(),
        startedAt: this.startedAt,
        commit: gitCommit(),
        lastError: this.lastError,
        lastUpdate: lastUpdate(),
        controlAt: this.control.appliedAt,
        intervalSeconds: this.intervalSeconds,
      })
      .catch((e) => log("Heartbeat failed:", String(e)));
  }

  private async recoverStuckJobs() {
    for (const { fileId, job } of await this.store.listJobs()) {
      if (job.status === "working" && job.workerId === WORKER_ID) {
        const tooMany = (job.attempts ?? 0) >= 2;
        job.status = tooMany ? "failed" : "queued";
        job.stage = tooMany ? "Failed" : "Restarted after the worker stopped";
        if (tooMany) job.error = "The studio computer stopped twice while making this. Try again, or try fewer or shorter clips.";
        job.updatedAt = new Date().toISOString();
        await this.store.saveJob(job, fileId);
      }
    }
  }

  private async ensureStarterMusic() {
    const lib = await this.store.listMusic("library");
    if (lib.length) return;
    log("Music library is empty: creating soft starter pads (replace them with real tracks any time).");
    const dir = sub("starter-music");
    for (const mood of ["calm", "uplifting", "worship", "reflective"]) {
      const f = path.join(dir, `starter-${mood}.mp3`);
      try {
        if (!fs.existsSync(f)) await makeStarterPad(f, mood);
        await this.store.addLibraryMusic(f, mood);
      } catch (e) {
        log("Couldn't create starter music:", String(e));
      }
    }
  }

  private async scheduleAuto(s: Settings) {
    if (!s.auto.enabled) {
      this.nextAutoRun = undefined;
      return;
    }
    const [h, m] = s.auto.runAt.split(":").map(Number);
    const runMinutes = h * 60 + m;
    const now = zonedParts(s.auto.timezone);
    const state = await this.store.readState<{ lastAutoDate?: string }>("auto", {}, true);
    const doneToday = state.lastAutoDate === now.date;
    this.nextAutoRun = `${doneToday || now.minutes >= runMinutes ? "tomorrow" : "today"} ${s.auto.runAt} (${s.auto.timezone})`;
    if (doneToday || now.minutes < runMinutes) return;

    const ts = new Date().toISOString();
    const jobs: Job[] = [];
    if (s.auto.reelsPerDay > 0) {
      jobs.push({
        id: newJobId(),
        status: "queued",
        source: "auto",
        createdAt: ts,
        updatedAt: ts,
        request: {
          type: "verse",
          count: s.auto.reelsPerDay,
          theme: "",
          language: s.auto.teluguPercent >= 100 ? "telugu" : s.auto.teluguPercent <= 0 ? "english" : "mixed",
          preset: "auto",
          references: [],
          instructions: "",
        },
        stage: "Waiting",
        progress: 0,
        outputs: [],
        log: [],
        attempts: 0,
      });
    }
    if (carouselDays(s.auto.carouselsPerWeek).includes(now.weekday)) {
      jobs.push({
        id: newJobId(),
        status: "queued",
        source: "auto",
        createdAt: ts,
        updatedAt: ts,
        request: { type: "carousel", topic: "", slides: 5, language: s.auto.teluguPercent >= 60 ? "telugu" : "english", preset: "auto" },
        stage: "Waiting",
        progress: 0,
        outputs: [],
        log: [],
        attempts: 0,
      });
    }
    // Mark the day as done first, so a failure below can never queue the batch twice.
    await this.store.writeState("auto", { lastAutoDate: now.date, createdAt: ts, jobs: jobs.map((j) => j.id) });
    for (const j of jobs) await this.store.saveJob(j);
    log(`Auto mode: queued ${jobs.length} job(s) for ${now.date}.`);
  }

  private async runNext(settings: Settings): Promise<boolean> {
    const queued = (await this.store.listJobs())
      .filter((j) => j.job.status === "queued")
      .sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt));
    if (!queued.length) return false;
    const { fileId, job } = queued[0];
    if (await this.store.isCancelRequested(job.id)) {
      await this.store.saveJob({ ...job, status: "cancelled", stage: "Cancelled", updatedAt: new Date().toISOString() }, fileId);
      return true;
    }
    await this.process(fileId, job, settings);
    return true;
  }

  private async process(fileId: string, job: Job, settings: Settings) {
    this.busy = true;
    this.current = job.id;
    const work = sub("work", job.id);
    let saving = Promise.resolve();
    const state: Job = { ...job, status: "working", workerId: WORKER_ID, stage: "Starting", progress: 0, error: undefined, attempts: (job.attempts ?? 0) + 1 };
    let lastWrite = 0;
    const save = (force = false) => {
      const now = Date.now();
      if (!force && now - lastWrite < 4000) return saving;
      lastWrite = now;
      state.updatedAt = new Date().toISOString();
      const snapshot = JSON.parse(JSON.stringify(state)) as Job;
      saving = saving.then(() => this.store.saveJob(snapshot, fileId).then(() => undefined)).catch((e) => log("Job save failed:", String(e)));
      return saving;
    };
    const ctx: Ctx = {
      store: this.store,
      settings,
      job: state,
      fileId,
      work,
      ai: this.ai,
      update: async (p) => {
        const stageChanged = p.stage !== undefined && p.stage !== state.stage;
        Object.assign(state, p);
        if (p.stage) {
          state.log = [...state.log, `${new Date().toISOString().slice(11, 19)} ${p.stage}`].slice(-60);
          log(`[${job.id}] ${p.stage}`);
        }
        await save(stageChanged || p.outputs !== undefined);
      },
    };
    log(`Starting ${job.request.type} job ${job.id}`);
    await save(true);
    await this.beat();
    const pulse = setInterval(() => void this.beat(), 60000);
    try {
      await loadLearned(this.store);
      const t = job.request.type;
      let outputs: Job["outputs"] = [];
      if (t === "verse") outputs = await runVerseJob(ctx);
      else if (t === "edit") outputs = await runEditJob(ctx);
      else if (t === "carousel") outputs = await runCarouselJob(ctx);
      else if (t === "revise") outputs = await runReviseJob(ctx);
      else if (t === "learn") {
        await ctx.update({ stage: "Reading your ratings and notes", progress: 0.3 });
        await learnIfNeeded(this.store, this.ai, settings.advanced.claudeModel || undefined, true);
      }
      state.outputs = outputs;
      const review = job.source === "auto" && settings.auto.approval === "review";
      state.status = review ? "review" : "done";
      state.stage = review ? "Ready for your review" : "Done";
      state.progress = 1;
      await save(true);
      rmrf(work);
      log(`Finished job ${job.id}`);
    } catch (e) {
      if (e instanceof Cancelled) {
        state.status = "cancelled";
        state.stage = "Cancelled";
      } else {
        state.status = "failed";
        state.error = e instanceof Error ? e.message : String(e);
        state.stage = "Failed";
        this.lastError = `${new Date().toISOString()} Job ${job.id}: ${state.error}`;
        log(`Job ${job.id} failed:`, state.error);
      }
      await save(true);
    } finally {
      clearInterval(pulse);
      await saving;
      this.busy = false;
      this.current = undefined;
      this.cleanupOldWork();
      await this.beat();
    }
  }

  private cleanupOldWork() {
    const dir = sub("work");
    const entries = fs
      .readdirSync(dir)
      .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const e of entries.slice(5)) rmrf(path.join(dir, e.n));
  }
}
