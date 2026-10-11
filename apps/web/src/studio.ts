import { Feedback, LEARNED_FILE, outputKey, type OutputItem, type ReviseChanges } from "@shared/schema";
// App data: settings, jobs and worker status, all read from Drive.
import { useCallback, useEffect, useRef, useState } from "react";
import { Heartbeat, Job, JobRequest, Settings, WorkerControl, defaultSettings, newJobId } from "@shared/schema";
import * as g from "./google";

export interface JobEntry {
  fileId: string;
  job: Job;
}

export interface Studio {
  folders: g.Folders;
  settings: Settings;
  settingsId?: string;
  jobs: JobEntry[];
  worker: Heartbeat | null;
  feedback: Map<string, { fileId: string; fb: Feedback }>;
}

export async function loadSettings(f: g.Folders): Promise<{ settings: Settings; id?: string }> {
  const file = await g.findChild(f.root, "settings.json");
  if (!file) {
    const s = defaultSettings();
    const id = await g.writeJson(s, { parent: f.root, name: "settings.json" });
    return { settings: s, id };
  }
  const parsed = Settings.safeParse(await g.readJson(file.id));
  return { settings: parsed.success ? parsed.data : defaultSettings(), id: file.id };
}

export async function loadJobs(f: g.Folders, limit = 40): Promise<JobEntry[]> {
  const files = (await g.children(f.Jobs, "mimeType='application/json'", { orderBy: "createdTime desc", pageSize: limit })).slice(0, limit);
  const out = await Promise.all(
    files.map(async (file) => {
      try {
        const p = Job.safeParse(await g.readJson(file.id));
        return p.success ? { fileId: file.id, job: p.data } : null;
      } catch {
        return null;
      }
    }),
  );
  return out.filter((x): x is JobEntry => !!x).sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
}

export async function loadWorker(f: g.Folders): Promise<Heartbeat | null> {
  const file = await g.findChild(f.State, "worker.json");
  if (!file) return null;
  const p = Heartbeat.safeParse(await g.readJson(file.id).catch(() => null));
  return p.success ? p.data : null;
}

export async function loadControl(f: g.Folders): Promise<{ id?: string; control: WorkerControl | null }> {
  const file = await g.findChild(f.State, "control.json");
  if (!file) return { control: null };
  const p = WorkerControl.safeParse(await g.readJson(file.id).catch(() => null));
  return { id: file.id, control: p.success ? p.data : null };
}

/** Sends a request to the studio computer; it applies it on its next check (within about a minute). */
export async function sendControl(f: g.Folders, change: Omit<WorkerControl, "requestedAt">): Promise<WorkerControl> {
  const { id } = await loadControl(f);
  const control: WorkerControl = { ...change, requestedAt: new Date().toISOString() };
  await g.writeJson(control, id ? { id } : { parent: f.State, name: "control.json" });
  return control;
}

export async function queueJob(f: g.Folders, request: JobRequest): Promise<Job> {
  const ts = new Date().toISOString();
  const job: Job = {
    id: newJobId(),
    status: "queued",
    source: "manual",
    createdAt: ts,
    updatedAt: ts,
    request: JobRequest.parse(request),
    stage: "Waiting for the studio computer",
    progress: 0,
    outputs: [],
    log: [],
    attempts: 0,
  };
  await g.writeJson(job, { parent: f.Jobs, name: `${job.id}.json` });
  return job;
}

export async function cancelJob(f: g.Folders, entry: JobEntry) {
  await g.writeJson({ cancel: true, at: new Date().toISOString() }, { parent: f.Jobs, name: `${entry.job.id}.cancel`, mimeType: "text/plain" });
  if (entry.job.status === "queued") {
    await g.writeJson({ ...entry.job, status: "cancelled", stage: "Cancelled", updatedAt: new Date().toISOString() }, { id: entry.fileId });
  }
}

export async function setJobStatus(entry: JobEntry, status: Job["status"], stage: string) {
  await g.writeJson({ ...entry.job, status, stage, updatedAt: new Date().toISOString() }, { id: entry.fileId });
}

export async function removeJob(entry: JobEntry) {
  await g.trash(entry.fileId);
}

export function workerOnline(w: Heartbeat | null) {
  return !!w && Date.now() - Date.parse(w.lastSeen) < 3 * 60 * 1000;
}

export function useStudio(enabled: boolean) {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const foldersRef = useRef<g.Folders | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (!foldersRef.current) foldersRef.current = await g.ensureFolders();
      const f = foldersRef.current;
      const [{ settings, id }, jobs, worker, feedback] = await Promise.all([
        loadSettings(f),
        loadJobs(f),
        loadWorker(f),
        loadFeedback(f).catch(() => new Map()),
      ]);
      setStudio({ folders: f, settings, settingsId: id, jobs, worker, feedback });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  const saveSettings = useCallback(
    async (s: Settings) => {
      if (!studio) return;
      const parsed = Settings.parse(s);
      const id = await g.writeJson(parsed, studio.settingsId ? { id: studio.settingsId } : { parent: studio.folders.root, name: "settings.json" });
      setStudio({ ...studio, settings: parsed, settingsId: id });
    },
    [studio],
  );

  return { studio, error, refresh, saveSettings };
}

// ---------------------------------------------------------------------------
// Feedback and revisions


export async function loadFeedback(f: g.Folders): Promise<Map<string, { fileId: string; fb: Feedback }>> {
  const files = await g.children(f.Feedback, "mimeType='application/json'", { orderBy: "createdTime desc", pageSize: 200 });
  const out = new Map<string, { fileId: string; fb: Feedback }>();
  await Promise.all(
    files.map(async (file) => {
      try {
        const p = Feedback.safeParse(await g.readJson(file.id));
        if (p.success && !out.has(p.data.outputKey)) out.set(p.data.outputKey, { fileId: file.id, fb: p.data });
      } catch {
        /* skip */
      }
    }),
  );
  return out;
}

export async function saveFeedback(
  f: g.Folders,
  job: Job,
  o: OutputItem,
  data: { rating?: number; tags: string[]; note: string; remember: boolean; preset?: string },
  existingFileId?: string,
) {
  const fb: Feedback = {
    id: `${job.id}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    jobId: job.id,
    outputKey: outputKey(job.id, o),
    title: o.title,
    source: o.source ?? (job.request.type === "revise" ? undefined : (job.request.type as "verse" | "edit" | "carousel")),
    preset: data.preset,
    rating: data.rating,
    tags: data.tags,
    note: data.note,
    remember: data.remember,
  };
  return g.writeJson(fb, existingFileId ? { id: existingFileId } : { parent: f.Feedback, name: `${fb.id}.json` });
}

export async function queueRevision(f: g.Folders, job: Job, o: OutputItem, changes: ReviseChanges, instruction: string, remember: boolean) {
  if (!o.specFileId) throw new Error("This video was made before quick changes existed. Make a new one to use them.");
  return queueJob(f, { type: "revise", sourceJobId: job.id, sourceTitle: o.title, specFileId: o.specFileId, changes, instruction, remember });
}

export async function loadSpec(id: string): Promise<Record<string, any>> {
  return g.readJson(id);
}

export async function loadLearned(f: g.Folders): Promise<{ id?: string; text: string }> {
  const file = await g.findChild(f.root, LEARNED_FILE);
  if (!file) return { text: "" };
  return { id: file.id, text: await (await g.blob(file.id)).text() };
}

export async function saveLearned(f: g.Folders, text: string, id?: string) {
  await g.writeText(text, id ? { id } : { parent: f.root, name: LEARNED_FILE });
}
