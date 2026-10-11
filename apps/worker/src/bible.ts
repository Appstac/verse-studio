// Exact verse text comes from bible-api.com (public-domain translations), so
// on-screen scripture is never paraphrased or misremembered by the AI.
import { log } from "./log";

const cache = new Map<string, { text: string; reference: string }>();

export async function fetchVerse(reference: string, translation: string) {
  const key = `${translation}:${reference}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation}`;
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`bible-api.com returned ${res.status} for "${reference}"`);
      const j = (await res.json()) as { text?: string; reference?: string; error?: string };
      if (!j.text) throw new Error(j.error ?? `No text for ${reference}`);
      const text = j.text
        .replace(/\s+/g, " ")
        .replace(/\s([,.;:!?])/g, "$1")
        .trim();
      const out = { text, reference: j.reference ?? reference };
      cache.set(key, out);
      return out;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  log("Verse lookup failed:", reference, String(lastErr));
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const TRANSLATION_LABEL: Record<string, string> = { web: "WEB", kjv: "KJV", bbe: "BBE", asv: "ASV" };
