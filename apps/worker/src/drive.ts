import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { google, type drive_v3 } from "googleapis";
import { APP_MARKER, ROOT_FOLDER_NAME, SUBFOLDERS } from "../../../shared/schema";
import { loadCredentials, loadToken, saveToken } from "./config";

const FOLDER = "application/vnd.google-apps.folder";
let client: drive_v3.Drive | null = null;

export function drive(): drive_v3.Drive {
  if (client) return client;
  const creds = loadCredentials();
  const token = loadToken();
  if (!token) throw new Error("Not signed in to Google Drive. Run: npm run login");
  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials(token);
  auth.on("tokens", (t) => saveToken({ ...token, ...t }));
  client = google.drive({ version: "v3", auth });
  return client;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function findChild(parentId: string | "root", name: string, folderOnly = false) {
  const q = [`name='${esc(name)}'`, `'${parentId}' in parents`, "trashed=false"];
  if (folderOnly) q.push(`mimeType='${FOLDER}'`);
  const res = await drive().files.list({ q: q.join(" and "), fields: "files(id,name,mimeType,modifiedTime)", pageSize: 10, orderBy: "createdTime" });
  return res.data.files?.[0] ?? null;
}

export async function createFolder(name: string, parentId?: string, marker = false) {
  const res = await drive().files.create({
    requestBody: {
      name,
      mimeType: FOLDER,
      parents: parentId ? [parentId] : undefined,
      appProperties: marker ? { app: APP_MARKER } : undefined,
    },
    fields: "id",
  });
  return res.data.id!;
}

export type FolderMap = Record<(typeof SUBFOLDERS)[number] | "root", string>;
let folders: FolderMap | null = null;

// Finds (or creates) the "Verse Studio" folder and its subfolders.
export async function ensureFolders(): Promise<FolderMap> {
  if (folders) return folders;
  const res = await drive().files.list({
    // drive.file only ever shows files this app created, so the name is enough.
    q: `name='${esc(ROOT_FOLDER_NAME)}' and mimeType='${FOLDER}' and trashed=false and 'root' in parents`,
    fields: "files(id,createdTime)",
    orderBy: "createdTime",
  });
  const rootId = res.data.files?.[0]?.id ?? (await createFolder(ROOT_FOLDER_NAME, undefined, true));
  const map: Partial<FolderMap> = { root: rootId };
  for (const sub of SUBFOLDERS) {
    const parts = sub.split("/");
    let parent = rootId;
    for (const part of parts) {
      const found = await findChild(parent, part, true);
      parent = found?.id ?? (await createFolder(part, parent));
    }
    map[sub] = parent;
  }
  folders = map as FolderMap;
  return folders;
}

export async function ensureSubfolder(parentId: string, name: string) {
  const found = await findChild(parentId, name, true);
  return found?.id ?? createFolder(name, parentId);
}

export async function listFiles(parentId: string, extraQ = ""): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive().files.list({
      q: `'${parentId}' in parents and trashed=false${extraQ ? ` and ${extraQ}` : ""}`,
      fields: "nextPageToken, files(id,name,mimeType,size,modifiedTime,createdTime,appProperties)",
      pageSize: 200,
      pageToken,
      orderBy: "createdTime",
    });
    out.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export async function readJson<T = unknown>(fileId: string): Promise<T> {
  const res = await drive().files.get({ fileId, alt: "media" }, { responseType: "text" });
  const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  return JSON.parse(body) as T;
}

export async function writeJson(data: unknown, opts: { fileId?: string; parentId?: string; name?: string }) {
  const media = { mimeType: "application/json", body: JSON.stringify(data, null, 2) };
  if (opts.fileId) {
    await drive().files.update({ fileId: opts.fileId, media });
    return opts.fileId;
  }
  const res = await drive().files.create({
    requestBody: { name: opts.name, parents: opts.parentId ? [opts.parentId] : undefined, mimeType: "application/json" },
    media,
    fields: "id",
  });
  return res.data.id!;
}

export async function download(fileId: string, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await drive().files.get({ fileId, alt: "media" }, { responseType: "stream" });
  await pipeline(res.data as NodeJS.ReadableStream, fs.createWriteStream(dest));
  return dest;
}

export async function getMeta(fileId: string) {
  const res = await drive().files.get({ fileId, fields: "id,name,mimeType,size,modifiedTime" });
  return res.data;
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".txt": "text/plain",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

export async function upload(localPath: string, parentId: string, name = path.basename(localPath)) {
  const mimeType = MIME[path.extname(localPath).toLowerCase()] ?? "application/octet-stream";
  const res = await drive().files.create({
    requestBody: { name, parents: [parentId], mimeType },
    media: { mimeType, body: fs.createReadStream(localPath) },
    fields: "id",
  });
  return res.data.id!;
}

export async function trash(fileId: string) {
  await drive().files.update({ fileId, requestBody: { trashed: true } });
}
