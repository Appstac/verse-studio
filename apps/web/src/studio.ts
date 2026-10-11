// App data: settings, jobs and worker status, all read from Drive.
import { useCallback, useEffect, useRef, useState } from "react";
import { Heartbeat, Job, Settings, defaultSettings, newJobId, type JobRequest } from "@shared/schema";
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

export async function queueJob(f: g.Folders, request: JobRequest): Promise<Job> {
  const ts = new Date().toISOString();
  const job: Job = {
    id: newJobId(),
    status: "queued",
    source: "manual",
    createdAt: ts,
    updatedAt: ts,
    request,
    stage: "Waiting for the studio computer",
    progress: 0,
    outputs: [],
    log: [],
  };
  await g.writeJson(job, { parent: f.Jobs, name: `${job.id}.json` });
  return job;
}

export async function cancelJob(f: g.Folders, entry: JobEntry) {
  await g.writeJson({ cancel: true, at: new Date().toISOString() }, { parent: f.Jobs, name: `${entry.job.id}.cancel` });
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
      const [{ settings, id }, jobs, worker] = await Promise.all([loadSettings(f), loadJobs(f), loadWorker(f)]);
      setStudio({ folders: f, settings, settingsId: id, jobs, worker });
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
