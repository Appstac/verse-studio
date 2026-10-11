// What Claude is asked to produce, and the prompts that ask for it.
import { z } from "zod";
import { MOODS, PRESETS, type Settings } from "../../../shared/schema";

export const VerseItem = z.object({
  reference: z.string().describe('Bible reference in English book names, e.g. "Isaiah 41:10" or "Psalm 46:1-2"'),
  language: z.enum(["english", "telugu"]),
  teluguText: z.string().describe("For Telugu items only: the verse text in Telugu (Telugu Bible, BSI old version). Empty for English."),
  teluguReference: z.string().describe('For Telugu items only: the reference in Telugu script, e.g. "యెషయా 41:10". Empty for English.'),
  textHint: z.string().describe("The verse text as you remember it (used only as a fallback)."),
  hook: z.string().describe("Scroll-stopping opener shown for the first 2 seconds, max 9 words, same language as the item. Empty string for no hook."),
  emphasis: z.array(z.string()).describe("1-3 single words from the verse text to highlight"),
  mood: z.enum(MOODS),
  preset: z.enum(PRESETS),
  footageQuery: z.string().describe('2-4 English words for a calm stock background video matching the verse, e.g. "sunrise ocean", "candle light", "wheat field wind", "rain window". Used by the footage look.'),
  title: z.string().describe("Short internal title, 2-5 words, English"),
  caption: z.string().describe("Instagram caption, 2-4 short lines, warm and personal, ending with the call to action. No hashtags here."),
  hashtags: z.array(z.string()),
});
export const VersePlan = z.object({ items: z.array(VerseItem) });
export type VerseItem = z.infer<typeof VerseItem>;

export const EditSegment = z.object({
  clip: z.number().int().describe("0-based index of the source clip"),
  start: z.number().describe("start time in the source clip, seconds"),
  end: z.number().describe("end time in the source clip, seconds"),
  zoom: z.enum(["none", "in", "out", "punch"]).describe('"punch" = static tighter framing, used to alternate on jump cuts'),
  speed: z.number().describe("playback speed, 1 = normal, allowed 0.5 to 2"),
  textOverlay: z.string().describe("Optional short on-screen text for this segment, else empty string"),
});
export const EditPlan = z.object({
  title: z.string(),
  hook: z.string().describe("On-screen opener for the first 2 seconds (max 8 words) or empty string"),
  segments: z.array(EditSegment).min(1),
  transition: z.enum(["cut", "fade"]),
  layout: z.enum(["fill", "blur-pad"]),
  captionLanguage: z.enum(["english", "telugu"]),
  showCaptions: z.boolean(),
  mood: z.enum(MOODS),
  caption: z.string(),
  hashtags: z.array(z.string()),
  style: z.enum(["talking-head", "worship", "montage"]).describe("What kind of footage this mostly is"),
  emphasis: z.array(z.string()).describe("3-10 single spoken words to pop in the accent script font (the emotional or key words)"),
  overlays: z
    .array(
      z.object({
        clip: z.number().int().describe("Index of a photo/screenshot/short clip to float on top as a card"),
        at: z.number().describe("Output time in seconds when it appears"),
        duration: z.number().describe("Seconds on screen, 1.5 to 5"),
        position: z.enum(["top", "center", "corner"]),
      }),
    )
    .describe("B-roll cards floating over the main footage. Empty if none fit."),
  cta: z.string().describe("Closing call-to-action line for the end card, max 6 words, or empty"),
  notes: z.string().describe("One or two sentences explaining the edit choices"),
});
export type EditPlan = z.infer<typeof EditPlan>;

export const CarouselSlide = z.object({
  kind: z.enum(["cover", "body", "cta"]),
  title: z.string(),
  body: z.string().describe("Supporting text, 1-3 short sentences, or empty"),
  verseRef: z.string().describe("If this slide quotes scripture, the reference (the exact text will be inserted). Else empty."),
});
export const CarouselPlan = z.object({
  title: z.string(),
  preset: z.enum(PRESETS),
  slides: z.array(CarouselSlide).min(2),
  caption: z.string(),
  hashtags: z.array(z.string()),
});
export type CarouselPlan = z.infer<typeof CarouselPlan>;

// What the account owner has taught the studio through ratings and notes.
// Set by the worker before each job (see learn.ts).
let learned = "";
export function setLearned(text: string) {
  learned = text.trim();
}

function voice(s: Settings) {
  const taught = learned
    ? `\n\nWHAT THE ACCOUNT OWNER HAS TAUGHT YOU (from her ratings and notes on earlier videos; follow it closely, it overrides general advice):\n${learned}`
    : "";
  return [
    `The account is ${s.brand.handle}: a Christian Instagram account sharing daily Bible verses and encouragement in English and Telugu (many followers are Telugu Christians).`,
    `Tone: ${s.captions.tone}.`,
    `Call to action to end captions with (adapt naturally, keep the meaning): "${s.captions.cta}".`,
    `Hashtags: exactly ${s.captions.hashtagCount} per post (Instagram allows at most 5). Always include: ${s.captions.alwaysHashtags.join(" ") || "(none)"}. Lowercase, each starting with #.`,
    "Never invent quotes from real people, never mention politics, never promise health, wealth or specific outcomes.",
  ].join("\n") + taught;
}

function season(date: Date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (m === 12 && d <= 26) return "It is the Christmas season: lean towards Christmas, Emmanuel and joy themes for about half the items.";
  if (m === 12 || (m === 1 && d <= 7)) return "It is New Year season: include new beginnings and God's faithfulness.";
  if ((m === 3 && d >= 20) || (m === 4 && d <= 25)) return "Easter may be near: include resurrection and hope themes for some items.";
  return "";
}

export function versePrompt(opts: {
  s: Settings;
  count: number;
  theme: string;
  language: "english" | "telugu" | "mixed";
  references: string[];
  instructions: string;
  presets: string[];
  recent: string[];
  now: Date;
}) {
  const { s } = opts;
  const lang =
    opts.language === "mixed"
      ? `Make about ${s.auto.teluguPercent}% of items Telugu and the rest English (at least one English item).`
      : `All items must be ${opts.language}.`;
  return `You are the content producer for a Christian Instagram account. Plan ${opts.count} short vertical "verse reels".

${voice(s)}

Each reel shows: a short hook line, then one Bible verse revealed word by word, then the reference.
Rules:
- Choose verses that are short and complete on their own: at most 40 words (ranges allowed only if still short).
- Every verse must be different and must not be one of the recently used references listed below.
- The hook must make a hurting or curious person stop scrolling, speak to a real feeling, and lead into the verse. No clickbait, no "stop scrolling", no "you won't believe".
- ${lang}
- For Telugu items: write the hook and caption in natural Telugu (a few English words are fine), give the verse in Telugu in "teluguText" and the Telugu-script reference in "teluguReference". "reference" stays in English (e.g. "John 14:27").
- emphasis: pick 1-3 words that appear exactly in the verse text that will be shown (Telugu words for Telugu items).
- preset is the visual style. Choose only from: ${opts.presets.join(", ")}. Vary them across items. Match the mood (night for comfort and peace, dawn for hope, paper for wisdom, minimal for bold declarations, garden for growth and rest, footage for a real stock video behind the verse, photo for her own background clips).
- mood picks the background music.
${opts.theme ? `- Theme for this batch: ${opts.theme}` : `- Themes to rotate through: ${s.auto.themes.join("; ")}`}
${opts.references.length ? `- Use exactly these references, in order: ${opts.references.join("; ")}` : ""}
${season(opts.now)}
${s.auto.extraInstructions ? `Extra instructions from the account owner: ${s.auto.extraInstructions}` : ""}
${opts.instructions ? `Instructions for this batch: ${opts.instructions}` : ""}

Recently used references (do not repeat): ${opts.recent.slice(-150).join("; ") || "none"}

Return JSON with "items" (exactly ${opts.count}).`;
}

export function editPrompt(opts: {
  s: Settings;
  userPrompt: string;
  targetSeconds: number;
  clips: Array<{ index: number; name: string; duration: number; width: number; height: number; hasAudio: boolean; isImage: boolean; sheet: string; transcript: string }>;
  layout: string;
  captions: boolean;
  captionLanguage: string;
}) {
  const { s } = opts;
  const clipText = opts.clips
    .map(
      (c) =>
        `Clip ${c.index}: "${c.name}", ${c.isImage ? "PHOTO/SCREENSHOT" : `${c.duration.toFixed(1)}s video`}, ${c.width}x${c.height}, ${c.hasAudio ? "has audio" : "no audio"}.
  Frames (3x3 grid, read left-to-right, top-to-bottom, evenly spaced through the clip): ${c.sheet}
  Transcript with times: ${c.transcript || "(no speech detected)"}`,
    )
    .join("\n\n");
  return `You are a professional short-form video editor making an Instagram Reel (9:16, 1080x1920) for a Christian account.

${voice(s)}

The owner uploaded these clips. Look at every frame grid image with the Read tool before deciding.

${clipText}

Owner's request: ${opts.userPrompt || "Make the best possible reel from these clips."}

Edit rules:
- Target length about ${opts.targetSeconds} seconds (within ±20%), unless the request says otherwise.
- Open on the strongest moment. The first 2 seconds decide whether people keep watching.
- Never cut in the middle of a sung line or spoken sentence: use the transcript times to cut on pauses.
- For worship or singing, prefer longer continuous segments over many quick cuts. For montages, use 1.5-4s segments with variety.
- Skip shaky, dark, blurry or blank moments you can see in the frame grids.
- Each segment: start < end, inside the clip's duration, at least 0.8 seconds.
- style: "talking-head" when one person mostly speaks to camera; "worship" for singing/music; "montage" for many short scenes.
- TALKING-HEAD edits (fast, punchy, like top creators):
  * Remove every pause longer than about 0.35s, ums, false starts and repeated takes. If a line is said several times, keep only the best (usually the LAST complete) take.
  * Many short segments that follow the speech (each a clean phrase). Jump cuts are fine.
  * Alternate zoom between "none" and "punch" on consecutive segments from the same clip so jump cuts feel intentional. Use "in" for the most emotional line.
  * Fill the frame (layout "fill"), captions on.
- WORSHIP edits: long continuous segments, never cut inside a sung line, zoom mostly "none"/"in", few or no overlays.
- zoom "in" adds a slow push-in, "punch" is a static tighter crop.
- emphasis: pick the words that carry the meaning (e.g. "Jesus", "never", "peace", numbers). They pop in a gold script font.
- overlays: photos, screenshots or short clips that illustrate what is being said, floating as a card for 1.5-5s. Use clips that are photos or screenshots for this rather than as main segments. Don't cover the face for long; prefer "top" or "corner" while someone talks.
- cta: an inviting closing line in the account's voice (e.g. "Type AMEN if this is for you") or empty.
- layout: "fill" crops to fill the vertical frame; "blur-pad" keeps the whole frame over a blurred copy (better for landscape group shots). ${opts.layout === "auto" ? "Choose." : `Use "${opts.layout}".`}
- showCaptions: ${opts.captions ? "true if there is meaningful speech or lyrics" : "false"}. captionLanguage: ${opts.captionLanguage === "auto" ? "the language being sung or spoken" : opts.captionLanguage === "te" ? "telugu" : "english"}.
- hook: a short on-screen opener only if it helps (e.g. "Telugu Christmas carols in Dallas 🎄"). Empty string otherwise.
- textOverlay: rarely, only when it adds meaning (a number, a key phrase).
- mood picks the background music for the music versions.

Return the JSON plan.`;
}

export function carouselFromVideoPrompt(opts: { s: Settings; transcript: string; reelTitle: string; reelCaption: string; presets: string[] }) {
  return `Turn this reel into a matching swipeable Instagram carousel (5-7 slides, 1080x1350) so the same message shows up in a second format.

${voice(opts.s)}

Reel title: ${opts.reelTitle}
Reel caption: ${opts.reelCaption}
What was said or sung in the video:
${opts.transcript || "(no speech; base it on the title and caption)"}

Structure: slide 1 (kind "cover") restates the hook as a short bold statement; middle slides (kind "body") each carry one point from the video in her own words, at least one quoting scripture via "verseRef"; last slide (kind "cta") invites saving and sharing.
preset: one of ${opts.presets.join(", ")}.
Return the JSON plan.`;
}

export function carouselPrompt(opts: { s: Settings; topic: string; slides: number; language: string; presets: string[]; recent: string[] }) {
  const { s } = opts;
  return `You are the content producer for a Christian Instagram account. Plan one swipeable carousel post with exactly ${opts.slides} slides (1080x1350).

${voice(s)}

Topic: ${opts.topic || `pick one from: ${s.auto.themes.join("; ")}`}
Language: ${opts.language === "telugu" ? "Telugu" : opts.language === "mixed" ? "English with an occasional Telugu phrase" : "English"}.

Structure:
- Slide 1 (kind "cover"): a short, emotionally honest statement that makes people swipe (max 7 words), with an optional one-line body.
- Middle slides (kind "body"): one idea each. Title max 6 words, body max 2 short sentences. At least one body slide should quote scripture: put its reference in "verseRef" and leave "body" as a one-line lead-in (the exact verse text is inserted automatically).
- Last slide (kind "cta"): invite them to save or share the post for someone who needs it.
- preset: choose from ${opts.presets.join(", ")}.
Recently used references (avoid): ${opts.recent.slice(-80).join("; ") || "none"}

Return the JSON plan.`;
}

// ---------------------------------------------------------------------------
// Revisions

export const VerseRevision = z.object({
  hook: z.string().describe("The hook line to show (same language as before unless asked). Empty string for no hook."),
  reference: z.string().describe("English Bible reference. Keep the current one unless the change asks for a different verse."),
  teluguText: z.string().describe("Only for Telugu reels: the Telugu verse text (keep current unless the verse changes). Empty for English."),
  teluguReference: z.string().describe("Only for Telugu reels: the reference in Telugu script. Empty for English."),
  preset: z.enum(PRESETS),
  speed: z.enum(["slower", "normal", "faster"]).describe("Reveal speed relative to the current version"),
  emphasis: z.array(z.string()),
  caption: z.string(),
  hashtags: z.array(z.string()),
  note: z.string().describe("One short sentence describing what you changed"),
});
export type VerseRevision = z.infer<typeof VerseRevision>;

export function verseRevisionPrompt(opts: { s: Settings; current: Record<string, unknown>; instruction: string; presets: string[] }) {
  return `You are revising one short vertical "verse reel" for a Christian Instagram account.

${voice(opts.s)}

The current version:
${JSON.stringify(opts.current, null, 2)}

The account owner asked for this change: "${opts.instruction}"

Apply exactly what she asked and keep everything else the same. Only change the verse if she asks for a different verse or theme.
preset must be one of: ${opts.presets.join(", ")}.
Return the full revised fields as JSON.`;
}

export function editRevisionPrompt(base: string, previous: EditPlan, instruction: string) {
  return `${base}

You already made a first version of this reel with this plan:
${JSON.stringify(previous, null, 2)}

The account owner watched it and asked for this change: "${instruction}"

Return a revised plan that applies her change precisely and keeps everything she didn't mention the same as before.`;
}

export function carouselRevisionPrompt(opts: { s: Settings; previous: CarouselPlan; instruction: string; presets: string[] }) {
  return `You are revising a swipeable Instagram carousel for a Christian account.

${voice(opts.s)}

The current carousel plan:
${JSON.stringify(opts.previous, null, 2)}

The account owner asked for this change: "${opts.instruction}"
Apply it precisely and keep everything else the same. preset must be one of: ${opts.presets.join(", ")}.
Return the full revised plan.`;
}

// ---------------------------------------------------------------------------
// Learning from feedback

export const LearnResult = z.object({
  guide: z.string().describe("The updated style guide in Markdown, under 450 words"),
  changes: z.string().describe("One or two sentences on what changed in the guide"),
});

export function learnPrompt(opts: { current: string; feedback: string; stats: string }) {
  return `You maintain a short style guide that teaches an AI video studio how one Christian Instagram creator likes her reels, carousels and video edits.

Current guide:
${opts.current || "(empty, this is the first version)"}

Statistics from her ratings (1 to 5 stars):
${opts.stats}

Her feedback, newest first (rating, tags, notes, and change requests she asked to remember):
${opts.feedback}

Write the updated guide:
- Concrete, actionable rules ("Hooks: one short question, under 7 words"; "Prefer the Night sky and Paper looks"; "Never use the Bold look"; "Edits: keep full sung lines, no cuts mid-chorus").
- Sections: Hooks, Verses and themes, Looks and pacing, Captions and hashtags, Video edits, Avoid.
- Weigh recent feedback more than old. When feedback conflicts, follow the newest.
- Only include what her feedback supports. Keep useful rules from the current guide unless contradicted.
- Under 450 words. No preamble.`;
}
