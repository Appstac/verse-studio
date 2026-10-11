// npm run demo: runs one verse batch, one carousel and one clip edit fully
// offline (local folder instead of Drive, canned plans instead of Claude) so
// the rendering pipeline can be tested on any machine.
import fs from "node:fs";
import path from "node:path";
import { newJobId, type Job } from "../../../shared/schema";
import { Engine } from "./engine";
import type { Planner } from "./jobs";
import { ffmpeg } from "./media";
import { LocalStore } from "./store";

const root = path.resolve(process.argv[2] ?? path.join(process.cwd(), "demo-output"));
fs.mkdirSync(root, { recursive: true });

export const mock: Planner = {
  async plan(kind, prompt) {
    if (kind === "learn") {
      return { guide: "## Hooks\n- Short questions under 7 words.\n\n## Looks and pacing\n- Prefer Night sky. Avoid Bold.", changes: "First version." } as never;
    }
    if (kind === "revise" && prompt.includes("verse reel")) {
      return {
        hook: "Are you tired of carrying it alone?",
        reference: "Isaiah 41:10",
        teluguText: "",
        teluguReference: "",
        preset: "night",
        speed: "slower",
        emphasis: ["strengthen"],
        caption: "He is holding you, even now.\n\nType AMEN 🙏",
        hashtags: ["#faith", "#jesuschrist"],
        note: "Hook turned into a question, night look, slower reveal.",
      } as never;
    }
    if (kind === "revise" && prompt.includes("carousel")) kind = "carousel";
    if (kind === "revise") kind = "edit";
    if (kind === "verse") {
      return {
        items: [
          {
            reference: "Isaiah 41:10",
            language: "english",
            teluguText: "",
            teluguReference: "",
            textHint: "Don't you be afraid, for I am with you. Don't be dismayed, for I am your God. I will strengthen you. Yes, I will help you.",
            hook: "When you feel like giving up, read this.",
            emphasis: ["with", "strengthen", "help"],
            mood: "uplifting",
            preset: "dawn",
            title: "Strength for today",
            caption: "You are not walking through this alone.\nHe is holding you up, even now.\n\nType AMEN if this is for you 🙏",
            hashtags: ["#jesuschrist", "#faith", "#bibleverse", "#encouragement", "#isaiah4110"],
          },
          {
            reference: "Psalm 46:10",
            language: "telugu",
            teluguText: "ఊరకుండుడి నేనే దేవుడనని తెలిసికొనుడి",
            teluguReference: "కీర్తనలు 46:10",
            textHint: "Be still, and know that I am God.",
            hook: "నీ హృదయం అలసిపోయిందా?",
            emphasis: ["దేవుడనని"],
            mood: "calm",
            preset: "night",
            title: "Be still",
            caption: "నిశ్శబ్దంగా ఉండు. ఆయనే దేవుడు.\n\nAMEN అని టైప్ చేయండి 🙏",
            hashtags: ["#jesuschrist", "#faith", "#teluguchristian", "#yesayya", "#bibleverse"],
          },
        ],
      } as never;
    }
    if (kind === "carousel") {
      return {
        title: "Stillness isn't weakness",
        preset: "paper",
        slides: [
          { kind: "cover", title: "Stillness isn't weakness", body: "Swipe if you're tired of fighting alone.", verseRef: "" },
          { kind: "body", title: "God fights for you", body: "", verseRef: "Exodus 14:14" },
          { kind: "body", title: "Rest is obedience", body: "Being still is trusting that He is already at work.", verseRef: "" },
          { kind: "cta", title: "Save this for the hard days", body: "Share it with someone who needs to rest today.", verseRef: "" },
        ],
        caption: "You don't have to carry every battle.\n\nSave this for when you need it 🤍",
        hashtags: ["#bestill", "#faith", "#jesuschrist", "#exodus1414", "#christian"],
      } as never;
    }
    return {
      title: "Sunday worship",
      hook: "Sunday worship moments 🙌",
      segments: [
        { clip: 0, start: 0.5, end: 3.5, zoom: "in", speed: 1, textOverlay: "" },
        { clip: 1, start: 1, end: 4, zoom: "none", speed: 1, textOverlay: "" },
        { clip: 0, start: 4, end: 6.5, zoom: "punch", speed: 1, textOverlay: "" },
      ],
      transition: "fade",
      layout: "blur-pad",
      style: "talking-head",
      emphasis: ["lord", "worthy"],
      overlays: [{ clip: 2, at: 2, duration: 2.5, position: "top" }],
      cta: "Type AMEN if you were blessed",
      captionLanguage: "english",
      showCaptions: true,
      mood: "worship",
      caption: "Grateful for every voice lifted in praise.\n\nType AMEN if you were blessed 🙏",
      hashtags: ["#worship", "#jesuschrist", "#faith", "#church", "#praise"],
      notes: "demo",
    } as never;
  },
  async verse(reference) {
    const known: Record<string, string> = {
      "Isaiah 41:10":
        "Don't you be afraid, for I am with you. Don't be dismayed, for I am your God. I will strengthen you. Yes, I will help you. Yes, I will uphold you with the right hand of my righteousness.",
      "Exodus 14:14": "Yahweh will fight for you, and you shall be still.",
    };
    if (!known[reference]) throw new Error("offline");
    return { text: known[reference], reference };
  },
  async transcribe() {
    const words = "we lift our hands to you lord you are worthy of all praise".split(" ");
    return { language: "en", text: words.join(" "), words: words.map((w, i) => ({ text: w, startMs: 600 + i * 420, endMs: 980 + i * 420 })) };
  },
};

async function main() {
  const store = new LocalStore(root);
  await store.init();
  const up = path.join(root, "Uploads");
  // Two synthetic "phone clips": one landscape with a tone, one vertical.
  if (!fs.existsSync(path.join(up, "clip-a.mp4"))) {
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=8", "-f", "lavfi", "-i", "sine=f=330:d=8", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(up, "clip-a.mp4")]);
    await ffmpeg(["-f", "lavfi", "-i", "mandelbrot=s=1200x900", "-frames:v", "1", path.join(up, "photo.png")]);
    await ffmpeg(["-f", "lavfi", "-i", "smptehdbars=s=1080x1920:r=30:d=6", "-f", "lavfi", "-i", "sine=f=440:d=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(up, "clip-b.mp4")]);
  }
  const ts = new Date().toISOString();
  const base = { status: "queued" as const, source: "manual" as const, createdAt: ts, updatedAt: ts, stage: "", progress: 0, outputs: [], log: [], attempts: 0 };
  const jobs: Job[] = [
    { ...base, id: newJobId(), request: { type: "verse", count: 2, theme: "", language: "mixed", preset: "auto", references: [], instructions: "" } },
    { ...base, id: newJobId(), request: { type: "carousel", topic: "", slides: 4, language: "english", preset: "auto" } },
    {
      ...base,
      id: newJobId(),
      request: {
        type: "edit",
        inputFileIds: ["Uploads/clip-a.mp4", "Uploads/clip-b.mp4", "Uploads/photo.png"],
        inputNames: ["clip-a.mp4", "clip-b.mp4", "photo.png"],
        prompt: "Short worship montage",
        targetSeconds: 10,
        layout: "auto",
        captions: true,
        captionLanguage: "auto",
        keepOriginalAudio: true,
        alsoCarousel: true,
      },
    },
  ];
  const only = process.env.DEMO_ONLY;
  for (const j of jobs) if (!only || j.request.type === only) await store.saveJob(j);
  await new Engine(store, mock).start({ once: true });
  for (const { job } of await store.listJobs()) {
    console.log(`${job.request.type}: ${job.status}${job.error ? ` (${job.error})` : ""} -> ${job.outputs.flatMap((o) => [...o.variants.map((v) => v.fileId), ...o.slideFileIds]).join(", ")}`);
  }
  process.exit(0);
}

if (process.argv[1]?.endsWith("demo.ts")) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
