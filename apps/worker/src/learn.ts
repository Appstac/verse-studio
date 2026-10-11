// Turns her ratings and notes into a short style guide that every future job
// follows. The guide lives in Google Drive ("Verse Studio/Learned style.md"),
// so it survives restarts and moving to another computer. A copy is written as
// a Claude Code skill on this machine so it's also available in Claude Code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Feedback } from "../../../shared/schema";
import { log } from "./log";
import { LearnResult, learnPrompt, setLearned } from "./plans";
import type { Planner } from "./jobs";
import type { Store } from "./store";

type FB = Feedback & { modified: string };

export function feedbackStats(list: FB[]): string {
  const rated = list.filter((f) => f.rating);
  if (!rated.length) return "No star ratings yet.";
  const avg = (xs: FB[]) => (xs.reduce((a, f) => a + (f.rating ?? 0), 0) / xs.length).toFixed(1);
  const group = (key: (f: FB) => string | undefined) => {
    const m = new Map<string, FB[]>();
    for (const f of rated) {
      const k = key(f);
      if (k) m.set(k, [...(m.get(k) ?? []), f]);
    }
    return [...m.entries()].map(([k, v]) => `${k}: ${avg(v)} (${v.length})`).join(", ");
  };
  const tags = new Map<string, number>();
  for (const f of list) for (const t of f.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${t} ×${n}`).join(", ");
  return [
    `Overall: ${avg(rated)} from ${rated.length} ratings`,
    `By type: ${group((f) => f.source) || "n/a"}`,
    `By look: ${group((f) => f.preset) || "n/a"}`,
    `Most used tags: ${topTags || "none"}`,
  ].join("\n");
}

function feedbackText(list: FB[]): string {
  return list
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 80)
    .map((f) => {
      const bits = [
        f.createdAt.slice(0, 10),
        f.source ?? "",
        f.preset ? `look=${f.preset}` : "",
        f.rating ? `${f.rating}★` : "",
        f.tags.length ? `tags: ${f.tags.join(", ")}` : "",
        f.note ? `note: "${f.note.replace(/\s+/g, " ").slice(0, 400)}"` : "",
      ].filter(Boolean);
      return `- "${f.title}": ${bits.join(" · ")}`;
    })
    .join("\n");
}

function skillPath() {
  return path.join(os.homedir(), ".claude", "skills", "verse-studio-style", "SKILL.md");
}

export function mirrorSkill(guide: string) {
  if (!guide.trim()) return;
  try {
    fs.mkdirSync(path.dirname(skillPath()), { recursive: true });
    fs.writeFileSync(
      skillPath(),
      `---
name: verse-studio-style
description: How the Verse Studio Instagram account likes its verse reels, carousels and video edits, learned from the owner's ratings and notes. Use when writing hooks, captions or planning edits for this account.
---

${guide.trim()}
`,
    );
  } catch (e) {
    log("Couldn't write the local skill copy:", String(e));
  }
}

// Loads the guide for prompts. Called before each job.
export async function loadLearned(store: Store): Promise<string> {
  const text = await store.readLearned().catch(() => "");
  setLearned(text);
  return text;
}

// Rebuilds the guide when there's feedback newer than the last rebuild.
export async function learnIfNeeded(store: Store, ai: Planner, model: string | undefined, force = false): Promise<boolean> {
  const all = (await store.listFeedback()).filter((f) => f.remember !== false);
  const state = await store.readState<{ lastLearnAt?: string; count?: number }>("learn", {});
  const newest = all.reduce((m, f) => (f.modified > m ? f.modified : m), "");
  if (!all.length || (!force && state.lastLearnAt && newest <= state.lastLearnAt)) return false;

  log(`Learning from ${all.length} feedback item(s)...`);
  const current = await store.readLearned().catch(() => "");
  const res = await ai.plan("learn" as never, learnPrompt({ current, feedback: feedbackText(all), stats: feedbackStats(all) }), LearnResult, {
    cwd: os.tmpdir(),
    model,
  });
  const header = `<!-- Updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} from ${all.length} feedback items. You can edit this in Settings. -->\n`;
  const guide = header + res.guide.trim() + "\n";
  await store.writeLearned(guide);
  await store.writeState("learn", { lastLearnAt: new Date().toISOString(), count: all.length, changes: res.changes });
  setLearned(guide);
  mirrorSkill(guide);
  log("Style guide updated:", res.changes);
  return true;
}
