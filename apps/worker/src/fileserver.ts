// Tiny local HTTP server so the renderer can stream job files (videos, images,
// logo) by URL. Bound to 127.0.0.1 only.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

let server: http.Server | null = null;
let base = "";
const roots = new Map<string, string>();

export async function startFileServer(): Promise<void> {
  if (server) return;
  server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://x");
      const [, key, ...rest] = decodeURIComponent(u.pathname).split("/");
      const root = roots.get(key);
      if (!root) return void res.writeHead(404).end();
      const file = path.resolve(root, rest.join("/"));
      if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file)) return void res.writeHead(404).end();
      const stat = fs.statSync(file);
      const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
      const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Number(range[2]) : stat.size - 1;
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...headers, "Content-Length": stat.size });
        if (req.method === "HEAD") return void res.end();
        fs.createReadStream(file).pipe(res);
      }
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Serves files under `dir` at <base>/<key>/...
export function mount(key: string, dir: string): (file: string) => string {
  roots.set(key, dir);
  return (file: string) => `${base}/${key}/${path.relative(dir, file).split(path.sep).map(encodeURIComponent).join("/")}`;
}

export function unmount(key: string) {
  roots.delete(key);
}
