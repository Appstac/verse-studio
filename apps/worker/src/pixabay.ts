// Free stock video backgrounds from Pixabay (pixabay.com/api/docs).
// Needs PIXABAY_API_KEY in apps/worker/.env. Search results are cached for 24h
// as Pixabay's terms ask, and downloaded clips are kept so revisions reuse them.
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { log } from "./log";
import { sub } from "./paths";

interface Hit {
  id: number;
  duration: number;
  tags: string;
  videos: Record<"large" | "medium" | "small" | "tiny", { url: string; width: number; height: number; size: number }>;
}

export const pixabayEnabled = () => !!process.env.PIXABAY_API_KEY;

const cacheFile = () => path.join(sub("stock"), "search-cache.json");
function readCache(): Record<string, { at: number; hits: Hit[] }> {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
  } catch {
    return {};
  }
}

async function api(params: Record<string, string>): Promise<Hit[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new Error("PIXABAY_API_KEY is not set");
  const cacheKey = JSON.stringify(params);
  const cache = readCache();
  const hit = cache[cacheKey];
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.hits;
  const u = new URL("https://pixabay.com/api/videos/");
  u.search = new URLSearchParams({ key, safesearch: "true", per_page: "20", ...params }).toString();
  const res = await fetch(u);
  if (res.status === 429) throw new Error("Pixabay rate limit reached, try again in a minute");
  if (!res.ok) throw new Error(`Pixabay returned ${res.status}`);
  const j = (await res.json()) as { hits: Hit[] };
  cache[cacheKey] = { at: Date.now(), hits: j.hits };
  for (const k of Object.keys(cache)) if (Date.now() - cache[k].at > 24 * 3600 * 1000) delete cache[k];
  fs.writeFileSync(cacheFile(), JSON.stringify(cache));
  return j.hits;
}

async function download(h: Hit): Promise<string> {
  const dest = path.join(sub("stock"), `${h.id}.mp4`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const v = h.videos as Record<string, { url: string; width: number; height: number } | undefined>;
  const r = (v.large?.url ? v.large : v.medium?.url ? v.medium : v.small)!;
  const res = await fetch(r.url);
  if (!res.ok || !res.body) throw new Error(`Pixabay download failed (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest + ".part"));
  fs.renameSync(dest + ".part", dest);
  return dest;
}

// Picks a calm clip for the query, preferring portrait, longer, and not
// recently used ones. Returns the local file and its Pixabay id.
export async function findFootage(query: string, avoid: number[] = []): Promise<{ id: number; file: string } | null> {
  const tries = [query, query.split(/\s+/).slice(0, 2).join(" "), "nature calm"];
  for (const q of tries) {
    if (!q.trim()) continue;
    try {
      const hits = (await api({ q: q.slice(0, 100) })).filter((h) => h.duration >= 6 && h.videos.medium?.url);
      if (!hits.length) continue;
      const score = (h: Hit) =>
        (h.videos.medium.height > h.videos.medium.width ? 3 : 0) + Math.min(h.duration, 20) / 10 - (avoid.includes(h.id) ? 5 : 0);
      const best = hits.sort((a, b) => score(b) - score(a))[0];
      return { id: best.id, file: await download(best) };
    } catch (e) {
      log("Pixabay search failed:", e instanceof Error ? e.message : String(e));
      return null;
    }
  }
  return null;
}

export async function footageById(id: number): Promise<string | null> {
  const local = path.join(sub("stock"), `${id}.mp4`);
  if (fs.existsSync(local)) return local;
  try {
    const hits = await api({ id: String(id) });
    return hits[0] ? await download(hits[0]) : null;
  } catch (e) {
    log("Pixabay lookup failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** A Pixabay photo by id (largest size the free API gives, 1280px), cached on disk. */
export async function photoById(id: number): Promise<string | null> {
  const dest = path.join(sub("stock"), `photo-${id}.jpg`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return null;
  try {
    const u = new URL("https://pixabay.com/api/");
    u.search = new URLSearchParams({ key, id: String(id) }).toString();
    const res = await fetch(u);
    if (!res.ok) throw new Error(`Pixabay returned ${res.status}`);
    const j = (await res.json()) as { hits: Array<{ largeImageURL?: string; fullHDURL?: string; webformatURL: string }> };
    const h = j.hits[0];
    const src = h?.fullHDURL || h?.largeImageURL || h?.webformatURL;
    if (!src) return null;
    const img = await fetch(src);
    if (!img.ok || !img.body) throw new Error(`Pixabay download failed (${img.status})`);
    await pipeline(Readable.fromWeb(img.body as never), fs.createWriteStream(dest + ".part"));
    fs.renameSync(dest + ".part", dest);
    return dest;
  } catch (e) {
    log("Pixabay photo failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
