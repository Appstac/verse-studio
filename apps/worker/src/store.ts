// Storage abstraction. DriveStore is what runs for real; LocalStore mirrors the
// same folder layout on disk for offline testing (npm run demo).
import fs from "node:fs";
import path from "node:path";
import { Heartbeat, Job, Settings, defaultSettings } from "../../../shared/schema";
import * as d from "./drive";
import { isAudioName, isImageName, isVideoName } from "./media";

export interface StoredFile {
  id: string;
  name: string;
}
export interface MusicFile extends StoredFile {
  mood: string;
}

export interface Store {
  init(): Promise<void>;
  getSettings(): Promise<Settings>;
  listJobs(): Promise<Array<{ fileId: string; job: Job }>>;
  readJob(fileId: string): Promise<Job>;
  saveJob(job: Job, fileId?: string): Promise<string>;
  download(fileId: string, dest: string): Promise<string>;
  fileName(fileId: string): Promise<string>;
  listMusic(kind: "library" | "mine"): Promise<MusicFile[]>;
  listBackgrounds(): Promise<StoredFile[]>;
  outputFolder(date: string, jobId: string): Promise<string>;
  upload(local: string, folderId: string, name?: string): Promise<string>;
  readState<T>(name: string, fallback: T, strict?: boolean): Promise<T>;
  writeState(name: string, data: unknown): Promise<void>;
  heartbeat(hb: Heartbeat): Promise<void>;
  addLibraryMusic(local: string, mood: string): Promise<void>;
  isCancelRequested(jobId: string): Promise<boolean>;
}

export class DriveStore implements Store {
  private f!: d.FolderMap;
  private stateIds = new Map<string, string>();
  private jobCache = new Map<string, { modified: string; job: Job | null }>();

  async init() {
    this.f = await d.ensureFolders();
  }

  async getSettings(): Promise<Settings> {
    const file = await d.findChild(this.f.root, "settings.json");
    if (!file?.id) {
      const s = defaultSettings();
      await d.writeJson(s, { parentId: this.f.root, name: "settings.json" });
      return s;
    }
    const parsed = Settings.safeParse(await d.readJson(file.id));
    return parsed.success ? parsed.data : defaultSettings();
  }

  async listJobs() {
    const files = await d.listFiles(this.f.Jobs, "mimeType='application/json'");
    const out: Array<{ fileId: string; job: Job }> = [];
    for (const f of files) {
      // Only download job files that changed since the last look.
      const cached = this.jobCache.get(f.id!);
      if (cached && cached.modified === f.modifiedTime) {
        if (cached.job) out.push({ fileId: f.id!, job: cached.job });
        continue;
      }
      try {
        const j = Job.safeParse(await d.readJson(f.id!));
        this.jobCache.set(f.id!, { modified: f.modifiedTime ?? "", job: j.success ? j.data : null });
        if (j.success) out.push({ fileId: f.id!, job: j.data });
      } catch {
        /* skip unreadable */
      }
    }
    return out;
  }

  async readJob(fileId: string) {
    return Job.parse(await d.readJson(fileId));
  }

  async saveJob(job: Job, fileId?: string) {
    return d.writeJson(job, fileId ? { fileId } : { parentId: this.f.Jobs, name: `${job.id}.json` });
  }

  download(fileId: string, dest: string) {
    return d.download(fileId, dest);
  }

  async fileName(fileId: string) {
    return (await d.getMeta(fileId)).name ?? fileId;
  }

  async listMusic(kind: "library" | "mine"): Promise<MusicFile[]> {
    const root = kind === "library" ? this.f["Music/Library"] : this.f["Music/Mine"];
    const out: MusicFile[] = [];
    const walk = async (id: string, mood: string, depth: number) => {
      for (const f of await d.listFiles(id)) {
        if (f.mimeType === "application/vnd.google-apps.folder" && depth < 2) await walk(f.id!, f.name!.toLowerCase(), depth + 1);
        else if (isAudioName(f.name ?? "")) out.push({ id: f.id!, name: f.name!, mood });
      }
    };
    await walk(root, "", 0);
    return out;
  }

  async listBackgrounds() {
    return (await d.listFiles(this.f.Backgrounds))
      .filter((f) => isVideoName(f.name ?? "") || isImageName(f.name ?? ""))
      .map((f) => ({ id: f.id!, name: f.name! }));
  }

  async outputFolder(date: string, jobId: string) {
    const day = await d.ensureSubfolder(this.f.Output, date);
    return d.ensureSubfolder(day, jobId);
  }

  upload(local: string, folderId: string, name?: string) {
    return d.upload(local, folderId, name);
  }

  // strict: a file that exists but can't be read is an error, not "empty".
  async readState<T>(name: string, fallback: T, strict = false): Promise<T> {
    const file = await d.findChild(this.f.State, `${name}.json`);
    if (!file?.id) return fallback;
    this.stateIds.set(name, file.id);
    try {
      return await d.readJson<T>(file.id);
    } catch (e) {
      if (strict) throw e;
      return fallback;
    }
  }

  async writeState(name: string, data: unknown) {
    let id = this.stateIds.get(name);
    if (!id) id = (await d.findChild(this.f.State, `${name}.json`))?.id ?? undefined;
    const newId = await d.writeJson(data, id ? { fileId: id } : { parentId: this.f.State, name: `${name}.json` });
    this.stateIds.set(name, newId);
  }

  async heartbeat(hb: Heartbeat) {
    await this.writeState("worker", hb);
  }

  async addLibraryMusic(local: string, mood: string) {
    const folder = await d.ensureSubfolder(this.f["Music/Library"], mood);
    await d.upload(local, folder);
  }

  async isCancelRequested(jobId: string) {
    return !!(await d.findChild(this.f.Jobs, `${jobId}.cancel`));
  }
}

// ---------------------------------------------------------------------------
// LocalStore: ids are paths relative to the root folder.
export class LocalStore implements Store {
  constructor(private root: string) {}
  private p = (...parts: string[]) => path.join(this.root, ...parts);

  async init() {
    for (const s of ["Jobs", "Uploads", "Output", "Music/Library", "Music/Mine", "Brand", "Backgrounds", "State"]) {
      fs.mkdirSync(this.p(s), { recursive: true });
    }
  }
  async getSettings() {
    const f = this.p("settings.json");
    if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(defaultSettings(), null, 2));
    return Settings.parse(JSON.parse(fs.readFileSync(f, "utf8")));
  }
  async listJobs() {
    return fs
      .readdirSync(this.p("Jobs"))
      .filter((n) => n.endsWith(".json"))
      .sort()
      .map((n) => ({ fileId: `Jobs/${n}`, job: Job.parse(JSON.parse(fs.readFileSync(this.p("Jobs", n), "utf8"))) }));
  }
  async readJob(fileId: string) {
    return Job.parse(JSON.parse(fs.readFileSync(this.p(fileId), "utf8")));
  }
  async saveJob(job: Job, fileId?: string) {
    const id = fileId ?? `Jobs/${job.id}.json`;
    fs.writeFileSync(this.p(id), JSON.stringify(job, null, 2));
    return id;
  }
  async download(fileId: string, dest: string) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(this.p(fileId), dest);
    return dest;
  }
  async fileName(fileId: string) {
    return path.basename(fileId);
  }
  async listMusic(kind: "library" | "mine") {
    const base = kind === "library" ? "Music/Library" : "Music/Mine";
    const out: MusicFile[] = [];
    const walk = (rel: string, mood: string) => {
      for (const n of fs.readdirSync(this.p(rel))) {
        const r = `${rel}/${n}`;
        if (fs.statSync(this.p(r)).isDirectory()) walk(r, n.toLowerCase());
        else if (isAudioName(n)) out.push({ id: r, name: n, mood });
      }
    };
    walk(base, "");
    return out;
  }
  async listBackgrounds() {
    return fs
      .readdirSync(this.p("Backgrounds"))
      .filter((n) => isVideoName(n) || isImageName(n))
      .map((n) => ({ id: `Backgrounds/${n}`, name: n }));
  }
  async outputFolder(date: string, jobId: string) {
    const rel = `Output/${date}/${jobId}`;
    fs.mkdirSync(this.p(rel), { recursive: true });
    return rel;
  }
  async upload(local: string, folderId: string, name = path.basename(local)) {
    const rel = `${folderId}/${name}`;
    fs.copyFileSync(local, this.p(rel));
    return rel;
  }
  async readState<T>(name: string, fallback: T, _strict = false) {
    const f = this.p("State", `${name}.json`);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : fallback;
  }
  async writeState(name: string, data: unknown) {
    fs.writeFileSync(this.p("State", `${name}.json`), JSON.stringify(data, null, 2));
  }
  async heartbeat(hb: Heartbeat) {
    await this.writeState("worker", hb);
  }
  async addLibraryMusic(local: string, mood: string) {
    fs.mkdirSync(this.p("Music/Library", mood), { recursive: true });
    fs.copyFileSync(local, this.p("Music/Library", mood, path.basename(local)));
  }
  async isCancelRequested(jobId: string) {
    return fs.existsSync(this.p("Jobs", `${jobId}.cancel`));
  }
}
