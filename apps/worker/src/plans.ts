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
  zoom: z
    .enum(["none", "in", "out", "punch", "pan"])
    .describe('"in" slow push-in, "out" slow pull-back, "punch" static tighter crop (alternate on jump cuts), "pan" slow move from focus to focusEnd'),
  focusX: z.number().describe("Where the main person/subject is, 0 = left edge, 1 = right edge of the source frame. The crop keeps this point centred."),
  focusY: z.number().describe("0 = top, 1 = bottom of the source frame. Use the face/upper body height (often 0.25-0.45)."),
  focusEndX: z.number().describe('For zoom "pan": where to end; otherwise same as focusX'),
  focusEndY: z.number().describe('For zoom "pan": where to end; otherwise same as focusY'),
  crop: z
    .number()
    .describe("How tight to frame: 1 = just fill the 9:16 frame, 1.2-1.5 = tighter on the person (crops away heads/phones in front, empty walls). Max 1.8."),
  speed: z.number().describe("playback speed, 1 = normal, allowed 0.5 to 2. Keep 1 when the sound of this segment is heard."),
  textOverlay: z.string().describe("Optional short on-screen text for this segment, else empty string"),
});
export const ClipGrade = z.object({
  clip: z.number().int(),
  exposure: z.number().describe("-1 darker ... 0 ... +1 brighter. Dark rooms +0.2 to +0.5; bright/blown-out -0.1 to -0.3"),
  contrast: z.number().describe("-1 flatter ... +1 punchier. Phone video usually +0.1 to +0.3"),
  highlights: z.number().describe("0-1: how much to recover blown-out whites (white curtains, windows, stage lights)"),
  saturation: z.number().describe("-1 ... +1. Usually 0 to +0.25; never make skin orange"),
  warmth: z.number().describe("-1 cooler ... +1 warmer. Cold/blue indoor light +0.2 to +0.4"),
});
export const EditPlan = z.object({
  title: z.string(),
  hook: z.string().describe("On-screen opener for the first 2 seconds (max 8 words, top third) or empty string"),
  altHooks: z.array(z.string()).describe("Alternative hooks in different styles (see request). Empty if only one is needed."),
  segments: z.array(EditSegment).min(1),
  transition: z.enum(["cut", "fade"]),
  layout: z.enum(["fill", "blur-pad"]),
  captionLanguage: z.enum(["english", "telugu"]),
  showCaptions: z.boolean(),
  mood: z.enum(MOODS),
  caption: z.string(),
  hashtags: z.array(z.string()),
  style: z.enum(["talking-head", "worship", "sermon", "montage"]).describe("What kind of footage this mostly is"),
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
  grades: z.array(ClipGrade).describe("Colour/light correction for every video clip used"),
  audioBed: z
    .object({ clip: z.number().int().describe("-1 for none"), start: z.number().describe("seconds in that clip where the continuous sound starts") })
    .describe(
      "Songs/worship: one continuous sound track taken from this clip, starting here and running for the whole edit, while the pictures may cut to other clips (crowd, hands raised, close-ups). clip -1 = each segment plays its own sound.",
    ),
  lyricLines: z
    .array(z.object({ text: z.string(), start: z.number(), end: z.number() }))
    .describe(
      "Only when lyrics were provided: each lyric line that is sung inside the edit, with start/end in seconds of the SOUND source (the audioBed clip, or the clip of the segment being heard). Empty otherwise.",
    ),
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

export interface EditClipInfo {
  index: number;
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  isImage: boolean;
  sheets: string[];
  sheetStep: number;
  transcript: string;
  audio: string;
  picture: string;
}

// Editing recipes, written from what works for church and worship accounts
// (hooks in 1-3 s, one idea per clip, captions for muted viewing, emotional peaks first).
const RECIPES: Record<string, string> = {
  worship: `WORSHIP SONG recipe (style "worship"):
  * Find the emotional peak: the chorus, the highest/most passionate line, a key change, hands raised, eyes closed, the congregation joining in. Use the loudness map: the loudest sustained stretch is usually the chorus.
  * OPEN ON THE PEAK (or the line right before it), not on the intro, tuning, or the first quiet verse. The hook text names the feeling or moment ("When the whole church sang this 🙏", "This chorus every morning"), max 8 words.
  * The SOUND must never jump: use an audioBed (one continuous stretch of the best-sounding clip) or, with a single clip, consecutive segments whose times touch (end of one = start of the next). Never cut inside a sung line; cut pictures on phrase ends (see "sound phrases").
  * Pictures: long shots of 3-8 s. Alternate between a tight frame on the singer (crop 1.3-1.5, zoom "in") and a wider/different frame (crop 1.0-1.15 or "pan"). With other clips (crowd, hands, kids singing) use them as picture-only cutaways over the audioBed.
  * Keep heads, phones and empty curtain out of frame with focus + crop. No whooshes, no pop-up captions, no jump-cut punches.
  * Speed: keep 1 (sound is heard). The edit may end on a held note; finish on a complete line.
  * Lyrics: if provided, show them line by line (lyricLines), timed to where each is sung. If not provided, showCaptions false unless the transcript is clearly correct lyrics.
  * cta: gentle and participatory ("Sing this over your week 🙏", "Send this to someone who needs it").`,
  talking: `TALKING / TESTIMONY recipe (style "talking-head"):
  * Hook in the first 1-3 seconds with the most surprising, honest or emotional sentence, said cold with no setup. Patterns that work: confession ("I almost gave up on God that year"), contrast ("Prayer didn't change my situation. It changed me."), a question people are already asking, a specific promise ("3 verses that got me through").
  * Remove every pause longer than ~0.35 s, ums, false starts and repeated takes; when a line is said several times keep the best (usually the LAST complete) take.
  * Many short segments that follow the speech. Alternate zoom "none" and "punch" on consecutive segments from the same clip; use "in" on the most emotional line. Focus on the face (focusY ~0.3), crop 1.0-1.2.
  * One idea per reel; land a short, repeatable closing line, then end right after it.
  * Captions on (most people watch muted). Emphasis words carry the meaning.`,
  sermon: `SERMON CLIP recipe (style "sermon"):
  * Pick ONE thought: a contrast statement, a scripture reveal, a story turn, a quotable definition, or a challenge. Skip announcements, inside jokes, prayers, and anything needing context.
  * Start at the turn, not the setup: the first 3 seconds must make sense with zero context. Hook text (max 8 words, top third) states the tension.
  * Middle: one insight. End right after the landing line (the sentence people would quote or send), never mid-sentence. 15-45 s is ideal.
  * Remove long pauses and false starts but keep the preacher's rhythm (fewer, longer segments than talking-head). Mild "in" pushes on key sentences, focus on the speaker, crop 1.1-1.4 to lose the pulpit clutter.
  * Captions on; emphasis on scripture names and key words.`,
  montage: `EVENT MONTAGE recipe (style "montage"):
  * Best, most joyful/emotional moments first (faces, hugs, kids, raised hands, the group). 1.5-4 s shots with variety (wide, close, detail), never two similar shots in a row.
  * If one clip has a song or strong sound, use it as audioBed and cut pictures on its phrase ends/beats; otherwise sound comes from the shots or the music versions.
  * Use "pan", "in" and "out" for life; focus on people, crop away clutter. End on the group / the most memorable shot.
  * Hook: name the occasion and feeling ("Christmas at Grace Church 🎄"). Captions only if someone speaks something meaningful.`,
};

export function editPrompt(opts: {
  s: Settings;
  userPrompt: string;
  targetSeconds: number;
  clips: EditClipInfo[];
  layout: string;
  captions: boolean;
  captionLanguage: string;
  editType: string;
  lyrics: string;
  songTitle: string;
  singer: string;
  focus: string;
  hookOptions: number;
  autoColor: boolean;
}) {
  const { s } = opts;
  const clipText = opts.clips
    .map(
      (c) =>
        `Clip ${c.index}: "${c.name}", ${c.isImage ? "PHOTO/SCREENSHOT" : `${c.duration.toFixed(1)}s video`}, ${c.width}x${c.height}, ${c.hasAudio ? "has sound" : "no sound"}.
  Frame grids (4x3, left-to-right then top-to-bottom, one frame every ${c.sheetStep.toFixed(1)}s, timestamps printed on each frame): ${c.sheets.join(", ")}
  ${c.picture ? `Picture: ${c.picture}` : ""}
  ${c.audio ? `Sound: ${c.audio}` : ""}
  Transcript with times: ${c.transcript || "(no clear speech detected)"}`,
    )
    .join("\n\n");
  const type = opts.editType === "auto" ? "" : opts.editType;
  const recipes = type ? RECIPES[type] : Object.values(RECIPES).join("\n\n");
  return `You are an award-winning short-form video editor for church and Christian creators, making an Instagram Reel (9:16, 1080x1920). The goal: a reel people watch to the end, feel moved and encouraged by, save and send to a friend.

${voice(s)}

The owner uploaded these clips. Open EVERY frame grid image with the Read tool before deciding: you need to see who is where in the frame, what is in the foreground, and where the best moments are.

${clipText}

Owner's request: ${opts.userPrompt || "Make the most engaging, encouraging reel possible from these clips."}
${type ? `Kind of video (chosen by the owner): ${type}.` : "Decide which kind of video this is (style)."}
${opts.focus ? `Keep this person/subject in frame: ${opts.focus}.` : ""}
${opts.songTitle || opts.singer ? `Song: "${opts.songTitle || "untitled"}"${opts.singer ? ` sung by ${opts.singer}` : ""} (a title card is added automatically).` : ""}
${opts.lyrics ? `Lyrics provided by the owner (use these exact lines for lyricLines, in this order; match them to the transcript and the sound phrases to time them):\n"""\n${opts.lyrics.slice(0, 4000)}\n"""` : ""}

${recipes}

General rules:
- Target length about ${opts.targetSeconds} seconds (within ±15%), unless the request says otherwise. The hook must land in the first 1-3 seconds.
- Each segment: start < end, inside the clip's duration, at least 0.8 s. Segments play in order.
- Reframing is the most important picture decision: from the frame grids, set focusX/focusY on the main person's face/upper body and crop so heads, phones, empty walls and clutter in front are cut away. Never crop off the person's head.
- Skip shaky, dark, blurry or blocked moments you can see in the frame grids.
- grades: ${opts.autoColor ? "one entry per video clip used, from its picture stats and frames (fix dark rooms, blown-out whites, cold light; keep skin natural)." : "return an empty list (colour correction is off)."}
- overlays: photos/screenshots/short clips floated as cards while someone talks; none for worship.
- layout: "fill" crops to fill the vertical frame; "blur-pad" keeps the whole frame over a blurred copy (only for wide group shots where cropping loses people). ${opts.layout === "auto" ? "Choose." : `Use "${opts.layout}".`}
- showCaptions: ${opts.captions ? "true if there is meaningful speech, or lyrics are provided" : "false"}. captionLanguage: ${opts.captionLanguage === "auto" ? "the language being sung or spoken" : opts.captionLanguage === "te" ? "telugu" : "english"}.
- hook: short, specific, emotional; same language as the audience of the clip (Telugu songs may use a Telugu or English hook). ${opts.hookOptions > 1 ? `altHooks: ${opts.hookOptions - 1} more hooks in clearly different styles (e.g. a question, a feeling, a bold statement).` : "altHooks: empty."}
- caption: 2-4 short lines that echo (not repeat) the hook, a line of the song or message, and the call to action.
- mood picks background music for the music versions (not used under songs).

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

// ---------------------------------------------------------------------------
// Quality check: Claude watches the rendered reel and fixes what's wrong once.

export const EditReview = z.object({
  verdict: z.enum(["good", "fix"]),
  problems: z.array(z.string()).describe("Concrete problems seen in the rendered reel, empty if good"),
  plan: EditPlan.describe("The plan to use: unchanged if good, corrected if fix"),
});
export type EditReview = z.infer<typeof EditReview>;

export function editReviewPrompt(base: string, plan: EditPlan, sheets: string[], step: number, seconds: number) {
  return `${base}

You made this plan:
${JSON.stringify(plan, null, 2)}

It was rendered into a ${seconds.toFixed(1)}s reel. Frame grids of the FINISHED reel (4x3, one frame every ${step.toFixed(1)}s, timestamps on each frame): ${sheets.join(", ")}
Open them with the Read tool and check like a demanding editor:
- Is the main person well framed in every shot (head not cut off, not too small, no heads/phones blocking, not off-centre)?
- Does it open on a strong moment and is the hook readable?
- Is any shot dark, washed out, blurry, shaky or blank? Is colour natural (no orange skin)?
- Do text, captions or lyrics overlap faces or each other, or sit too low (bottom 20% is covered by Instagram)?
- Does it end on a complete line/thought?
If everything is good, return verdict "good" with the same plan. Otherwise return verdict "fix", list the problems, and return a corrected plan (change only what fixes the problems).`;
}
