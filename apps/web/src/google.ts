// Google sign-in (Identity Services token flow) and a thin Drive REST client.
// The site has no server: the browser talks straight to the user's own Drive.
import { APP_MARKER, ROOT_FOLDER_NAME, SUBFOLDERS } from "@shared/schema";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPES = "https://www.googleapis.com/auth/drive.file openid email profile";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

declare global {
  interface Window {
    google?: any;
  }
}

let token: { value: string; expires: number } | null = null;
let tokenClient: any = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

export const hasClientId = () => !!CLIENT_ID;

function waitForGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - start > 15000) return reject(new Error("Google sign-in didn't load. Check your connection and reload."));
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function client() {
  if (tokenClient) return tokenClient;
  await waitForGis();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp: any) => {
      if (resp.error) {
        pending?.reject(new Error(resp.error_description || resp.error));
      } else {
        token = { value: resp.access_token, expires: Date.now() + (Number(resp.expires_in) - 60) * 1000 };
        try {
          sessionStorage.setItem("vs-token", JSON.stringify(token));
        } catch {
          /* ignore */
        }
        pending?.resolve(resp.access_token);
      }
      pending = null;
    },
    error_callback: (e: any) => {
      pending?.reject(new Error(e?.message || e?.type || "Sign-in was closed"));
      pending = null;
    },
  });
  return tokenClient;
}

export function restoreToken(): boolean {
  try {
    const t = JSON.parse(sessionStorage.getItem("vs-token") || "null");
    if (t && t.expires > Date.now()) {
      token = t;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function signIn(interactive = true): Promise<string> {
  const c = await client();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken({ prompt: interactive ? "" : "none" });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.value, () => undefined);
  token = null;
  try {
    sessionStorage.removeItem("vs-token");
  } catch {
    /* ignore */
  }
}

export class AuthLost extends Error {}

// Pop-ups only open on a click, so background refreshes never try to sign in:
// an expired session sends the user back to the sign-in button instead.
function lost(): never {
  token = null;
  try {
    sessionStorage.removeItem("vs-token");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("vs-auth-lost"));
  throw new AuthLost("Your Google session expired. Sign in again.");
}

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now()) return token.value;
  return lost();
}

async function api(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await accessToken();
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
  if (res.status === 401) lost();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

export async function whoAmI(): Promise<{ email: string; name: string }> {
  const r = await api("https://www.googleapis.com/oauth2/v3/userinfo");
  const j = await r.json();
  return { email: j.email, name: j.name || j.email };
}

export interface DFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const FIELDS = "files(id,name,mimeType,size,createdTime,modifiedTime)";

export async function list(q: string, opts: { orderBy?: string; pageSize?: number } = {}): Promise<DFile[]> {
  const out: DFile[] = [];
  let pageToken = "";
  do {
    const p = new URLSearchParams({
      q,
      fields: `nextPageToken,${FIELDS}`,
      pageSize: String(opts.pageSize ?? 200),
      orderBy: opts.orderBy ?? "createdTime",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const j = await (await api(`${API}/files?${p}`)).json();
    out.push(...j.files);
    pageToken = j.nextPageToken || "";
    if (opts.pageSize && out.length >= opts.pageSize) break;
  } while (pageToken);
  return out;
}

export const children = (parent: string, extra = "", opts: { orderBy?: string; pageSize?: number } = {}) =>
  list(`'${parent}' in parents and trashed=false${extra ? ` and ${extra}` : ""}`, opts);

export async function createFolder(name: string, parent?: string, marker = false): Promise<string> {
  const body: Record<string, unknown> = { name, mimeType: FOLDER };
  if (parent) body.parents = [parent];
  if (marker) body.appProperties = { app: APP_MARKER };
  const j = await (await api(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  return j.id;
}

export async function findChild(parent: string, name: string, folder = false): Promise<DFile | undefined> {
  const q = `name='${esc(name)}' and '${parent}' in parents and trashed=false${folder ? ` and mimeType='${FOLDER}'` : ""}`;
  return (await list(q, { pageSize: 5, orderBy: "createdTime" }))[0];
}

export type Folders = Record<(typeof SUBFOLDERS)[number] | "root", string>;

export async function ensureFolders(): Promise<Folders> {
  const roots = await list(
    `name='${esc(ROOT_FOLDER_NAME)}' and mimeType='${FOLDER}' and trashed=false and 'root' in parents`,
  );
  const root = roots[0]?.id ?? (await createFolder(ROOT_FOLDER_NAME, undefined, true));
  const map: Record<string, string> = { root };
  for (const sub of SUBFOLDERS) {
    let parent = root;
    for (const part of sub.split("/")) {
      parent = (await findChild(parent, part, true))?.id ?? (await createFolder(part, parent));
    }
    map[sub] = parent;
  }
  return map as Folders;
}

export async function ensureSubfolder(parent: string, name: string) {
  return (await findChild(parent, name, true))?.id ?? createFolder(name, parent);
}

export async function readJson<T>(id: string): Promise<T> {
  return (await api(`${API}/files/${id}?alt=media`)).json();
}

export async function writeJson(data: unknown, opts: { id?: string; parent?: string; name?: string; mimeType?: string }): Promise<string> {
  const body = JSON.stringify(data, null, 2);
  const mime = opts.mimeType ?? "application/json";
  if (opts.id) {
    await api(`${UPLOAD}/files/${opts.id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
    return opts.id;
  }
  const boundary = "vs" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: opts.name, parents: [opts.parent], mimeType: mime });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const j = await (
    await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    })
  ).json();
  return j.id;
}

// Resumable upload with progress, for big phone videos.
export async function uploadFile(file: File, parent: string, onProgress?: (p: number) => void): Promise<string> {
  const t = await accessToken();
  const start = await api(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.type || "application/octet-stream",
      "X-Upload-Content-Length": String(file.size),
    },
    body: JSON.stringify({ name: file.name, parents: [parent] }),
  });
  const location = start.headers.get("Location");
  if (!location) throw new Error("Drive didn't accept the upload.");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", location);
    xhr.setRequestHeader("Authorization", `Bearer ${t}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).id);
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(file);
  });
}

export async function blob(id: string): Promise<Blob> {
  return (await api(`${API}/files/${id}?alt=media`)).blob();
}

const urlCache = new Map<string, Promise<string>>();
export function objectUrl(id: string): Promise<string> {
  let p = urlCache.get(id);
  if (!p) {
    p = blob(id).then((b) => URL.createObjectURL(b));
    p.catch(() => urlCache.delete(id));
    urlCache.set(id, p);
  }
  return p;
}

export async function downloadFile(id: string, name: string) {
  const url = await objectUrl(id);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function trash(id: string) {
  await api(`${API}/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) });
}

export function driveFolderLink(id: string) {
  return `https://drive.google.com/drive/folders/${id}`;
}
