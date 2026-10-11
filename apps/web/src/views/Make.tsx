import React, { useEffect, useRef, useState } from "react";
import { PRESETS, brandingFromSettings, captionChoiceFromSettings, type EditType, type Language, type Preset, MEDIA_PRESETS } from "@shared/schema";
import { useApp } from "../App";
import * as g from "../google";
import { queueJob } from "../studio";
import { BrandingEditor, CaptionEditor, useLogoUrl } from "./StyleEditors";

type Mode = "edit" | "verse" | "carousel";

export const PRESET_INFO: Record<Preset, { label: string; swatch: string }> = {
  dawn: { label: "Dawn", swatch: "linear-gradient(180deg,#140b08,#8a4a26,#d58c4c)" },
  night: { label: "Night sky", swatch: "linear-gradient(180deg,#03050f,#1c2a55)" },
  paper: { label: "Paper", swatch: "#F2E8D5" },
  minimal: { label: "Bold", swatch: "#0A0A0B" },
  garden: { label: "Garden", swatch: "linear-gradient(165deg,#0e2416,#7f9c5e)" },
  photo: { label: "My backgrounds", swatch: "repeating-linear-gradient(45deg,#bbb 0 6px,#999 6px 12px)" },
  footage: { label: "Stock footage", swatch: "linear-gradient(135deg,#5b8fb9,#d9a066)" },
};

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function StylePicker({ value, onChange, allowPhoto }: { value: Preset | "auto"; onChange: (v: Preset | "auto") => void; allowPhoto: boolean }) {
  return (
    <div className="row" role="group" aria-label="Look">
      <button type="button" className="btn small" aria-pressed={value === "auto"} style={value === "auto" ? { borderColor: "var(--ink)" } : undefined} onClick={() => onChange("auto")}>
        Let Claude choose
      </button>
      {PRESETS.filter((p) => allowPhoto || !MEDIA_PRESETS.includes(p)).map((p) => (
        <button
          key={p}
          type="button"
          className="btn small"
          aria-pressed={value === p}
          style={value === p ? { borderColor: "var(--ink)" } : undefined}
          onClick={() => onChange(p)}
        >
          <span style={{ width: 16, height: 16, borderRadius: 4, background: PRESET_INFO[p].swatch, border: "1px solid var(--line)" }} />
          {PRESET_INFO[p].label}
        </button>
      ))}
    </div>
  );
}

interface Upload {
  key: string;
  name: string;
  progress: number;
  fileId?: string;
  error?: string;
  /** Local preview of the file (never uploaded twice). */
  url?: string;
  isVideo?: boolean;
  duration?: number;
  start?: number;
  end?: number;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}${t % 1 >= 0.05 ? `.${Math.floor((t % 1) * 10)}` : ""}`;

// Watch a clip and mark the part to use. Only that part is sent to the editor.
function TrimPanel({ u, onChange }: { u: Upload; onChange: (p: Partial<Upload>) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const dur = u.duration ?? 0;
  const start = u.start ?? 0;
  const end = u.end ?? dur;
  return (
    <div className="trim">
      {!failed ? (
        <video
          ref={video}
          src={u.url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => onChange({ duration: e.currentTarget.duration })}
          onError={() => setFailed(true)}
          onTimeUpdate={(e) => {
            // Preview loops inside the chosen part.
            if (u.end && e.currentTarget.currentTime > u.end) e.currentTarget.currentTime = u.start ?? 0;
          }}
        />
      ) : (
        <p className="hint">This browser can't preview this video format, but you can still type the times below.</p>
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn small" disabled={failed} onClick={() => video.current && onChange({ start: Math.min(video.current.currentTime, end - 0.5) })}>
          Start here
        </button>
        <button type="button" className="btn small" disabled={failed} onClick={() => video.current && onChange({ end: Math.max(video.current.currentTime, start + 0.5) })}>
          End here
        </button>
        <label className="row hint">
          From
          <input type="number" min={0} step={0.1} value={Number(start.toFixed(1))} style={{ width: 80 }} onChange={(e) => onChange({ start: Math.max(0, Number(e.target.value) || 0) })} />
          to
          <input type="number" min={0} step={0.1} value={Number(end.toFixed(1))} style={{ width: 80 }} onChange={(e) => onChange({ end: Math.max(0, Number(e.target.value) || 0) })} />
          s
        </label>
        <button type="button" className="btn quiet small" onClick={() => onChange({ start: undefined, end: undefined })}>
          Use whole clip
        </button>
      </div>
      <small className="hint">
        {u.start !== undefined || u.end !== undefined ? `Using ${fmt(start)} to ${fmt(end)} (${(end - start).toFixed(1)}s)` : `Using the whole clip${dur ? ` (${fmt(dur)})` : ""}`}. Claude picks the best moments inside this part.
      </small>
    </div>
  );
}

function Uploader({ uploads, setUploads }: { uploads: Upload[]; setUploads: React.Dispatch<React.SetStateAction<Upload[]>> }) {
  const { studio } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const add = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const isVideo = file.type.startsWith("video/") || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name);
      setUploads((u) => [...u, { key, name: file.name, progress: 0, isVideo, url: isVideo ? URL.createObjectURL(file) : undefined }]);
      g.uploadFile(file, studio.folders.Uploads, (p) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))))
        .then((id) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: 1, fileId: id } : x))))
        .catch((e) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: e.message } : x))));
    }
  };

  return (
    <div className="stack">
      <div
        className={`drop ${over ? "over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <p style={{ fontWeight: 600 }}>Add videos or photos</p>
        <p className="hint">Tap to choose from your phone or drag files here. They upload to your Drive while you write the prompt.</p>
        <input ref={input} type="file" accept="video/*,image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
      {uploads.length ? (
        <div className="files">
          {uploads.map((u) => (
            <div className="filerow" key={u.key}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
              <span className="row">
                <span className={u.error ? "pill failed" : u.fileId ? "pill done" : "pill"}>
                  {u.error ? "Failed" : u.fileId ? "Uploaded" : `${Math.round(u.progress * 100)}%`}
                </span>
                <button type="button" className="btn quiet small" aria-label={`Remove ${u.name}`} onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                  Remove
                </button>
              </span>
              {!u.fileId && !u.error ? (
                <div className="bar">
                  <i style={{ width: `${Math.max(2, u.progress * 100)}%` }} />
                </div>
              ) : null}
              {u.error ? <small style={{ gridColumn: "1 / -1", color: "var(--rose)" }}>{u.error}</small> : null}
              {u.isVideo && u.url ? (
                <details className="trimwrap" style={{ gridColumn: "1 / -1" }}>
                  <summary className="hint">
                    Preview and trim{u.start !== undefined || u.end !== undefined ? ` · ${fmt(u.start ?? 0)}–${fmt(u.end ?? u.duration ?? 0)}` : ""}
                  </summary>
                  <TrimPanel u={u} onChange={(p) => setUploads((x) => x.map((y) => (y.key === u.key ? { ...y, ...p } : y)))} />
                </details>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const EDIT_TYPE_HINT: Record<EditType, string> = {
  auto: "Claude looks and listens, then picks the right style.",
  worship: "Keeps whole sung lines, no jump cuts, gentle moves, lyrics on screen, no extra music over the singing.",
  talking: "Keeps the best take, cuts pauses and retakes, big pop-up captions, punch-in zooms.",
  sermon: "Finds the strongest 1-3 points, cuts cleanly between thoughts, clear captions, calm pacing.",
  montage: "Short varied shots cut to the music, with the best moments first.",
};

function EditForm() {
  const { studio, toast, go, refresh } = useApp();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(studio.settings.edit.defaultSeconds);
  const [layout, setLayout] = useState<"auto" | "fill" | "blur-pad">("auto");
  const [captions, setCaptions] = useState(true);
  const [capLang, setCapLang] = useState<"auto" | "en" | "te">("auto");
  const [keepAudio, setKeepAudio] = useState(true);
  const [alsoCarousel, setAlsoCarousel] = useState(false);
  const [editType, setEditType] = useState<EditType>("auto");
  const [lyrics, setLyrics] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [singer, setSinger] = useState("");
  const [focus, setFocus] = useState("");
  const [stabilize, setStabilize] = useState<"auto" | "on" | "off">("auto");
  const [cleanAudio, setCleanAudio] = useState(true);
  const [autoColor, setAutoColor] = useState(true);
  const [qualityCheck, setQualityCheck] = useState(false);
  const [extraLengths, setExtraLengths] = useState<number[]>([]);
  const [hookOptions, setHookOptions] = useState<1 | 2 | 3>(1);
  const [branding, setBranding] = useState(() => brandingFromSettings(studio.settings));
  const [captionChoice, setCaptionChoice] = useState(() => captionChoiceFromSettings(studio.settings));
  const logoUrl = useLogoUrl(studio.settings.brand.logoFileId);
  const [busy, setBusy] = useState(false);
  const ready = uploads.filter((u) => u.fileId);
  const song = editType === "worship" || editType === "auto";
  const uploading = uploads.some((u) => !u.fileId && !u.error);

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await queueJob(studio.folders, {
            type: "edit",
            inputFileIds: ready.map((u) => u.fileId!),
            inputNames: ready.map((u) => u.name),
            prompt,
            targetSeconds: seconds,
            layout,
            captions,
            captionLanguage: capLang,
            keepOriginalAudio: keepAudio,
            alsoCarousel,
            editType,
            lyrics: song ? lyrics.trim() : "",
            songTitle: song ? songTitle.trim() : "",
            singer: song ? singer.trim() : "",
            focus: focus.trim(),
            stabilize,
            cleanAudio,
            autoColor,
            qualityCheck,
            ranges: ready
              .map((u, index) => ({ index, start: u.start ?? 0, end: u.end ?? u.duration ?? 99999 }))
              .filter((r, i) => (ready[i].start !== undefined || ready[i].end !== undefined) && r.end > r.start + 0.5),
            extraLengths: extraLengths.filter((l) => Math.abs(l - seconds) >= 3),
            hookOptions,
            branding,
            captionChoice,
          });
          toast("Queued. It will appear under Reels when it's ready.");
          void refresh();
          go("today");
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Uploader uploads={uploads} setUploads={setUploads} />
      <label className="field">
        <span>What should the reel be?</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A 30 second reel of our Christmas carols. Start with the kids singing Podamu podamu, keep the whole chorus, end on the group shot."
        />
        <small>
          Claude watches the clips and listens before deciding the cuts. Talking to camera? Film the line as many times as you like: it keeps the best take,
          cuts the pauses, adds big captions and punch-in zooms. Add photos or screenshots and it floats them in as cards where they fit.
        </small>
      </label>
      <div className="field">
        <span>What kind of video is it?</span>
        <Seg
          value={editType}
          onChange={setEditType}
          label="Kind of video"
          options={[["auto", "Let Claude tell"], ["worship", "Worship song"], ["talking", "Talking / testimony"], ["sermon", "Sermon clip"], ["montage", "Event montage"]]}
        />
        <small>{EDIT_TYPE_HINT[editType]}</small>
      </div>
      {song ? (
        <details className="subpanel" open={editType === "worship"}>
          <summary>Song details (optional, makes song reels much better)</summary>
          <div className="grid2">
            <label className="field">
              <span>Song title</span>
              <input type="text" value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="e.g. Yesu Raja" />
            </label>
            <label className="field">
              <span>Sung by</span>
              <input type="text" value={singer} onChange={(e) => setSinger(e.target.value)} placeholder="e.g. Sis. Mary, Grace Church choir" />
            </label>
          </div>
          <label className="field">
            <span>Lyrics</span>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={"Paste the lyrics, one line per line, in Telugu or English.\nThey're shown line by line in time with the singing, instead of guessing words from the audio."}
              style={{ minHeight: 140 }}
            />
          </label>
        </details>
      ) : null}
      <label className="field">
        <span>Who should stay in frame? (optional)</span>
        <input type="text" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. the woman in beige singing at the podium" />
        <small>The edit crops and slowly moves toward this person, and away from heads and phones in front of the camera.</small>
      </label>
      <label className="field">
        <span>Length: about {seconds} seconds</span>
        <input type="range" min={8} max={90} step={1} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
      </label>
      <div className="grid2">
        <div className="field">
          <span>Framing</span>
          <Seg value={layout} onChange={setLayout} label="Framing" options={[["auto", "Auto"], ["fill", "Fill the screen"], ["blur-pad", "Keep whole frame"]]} />
        </div>
        <div className="field">
          <span>Captions</span>
          <div className="row">
            <Seg value={captions ? capLang : ("off" as const)} label="Captions" onChange={(v) => (v === "off" ? setCaptions(false) : (setCaptions(true), setCapLang(v)))} options={[["auto", "Auto"], ["en", "English"], ["te", "Telugu"], ["off", "Off"]]} />
          </div>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
        <span>
          Keep the original sound (singing, speech)
          <br />
          <small className="hint">Music versions are mixed quietly underneath speech. For songs, no music is added on top of the singing.</small>
        </span>
      </label>
      <details className="subpanel">
        <summary>More versions from the same upload{extraLengths.length || hookOptions > 1 ? ` · ${1 + extraLengths.length + hookOptions - 1} videos` : ""}</summary>
        <div className="field">
          <span>Also make these lengths</span>
          <div className="chips">
            {[15, 30, 45, 60].filter((l) => Math.abs(l - seconds) >= 3).map((l) => (
              <button
                key={l}
                type="button"
                className={`chip ${extraLengths.includes(l) ? "on" : ""}`}
                aria-pressed={extraLengths.includes(l)}
                onClick={() => setExtraLengths((x) => (x.includes(l) ? x.filter((y) => y !== l) : [...x, l].slice(-3)))}
              >
                {l}s
              </button>
            ))}
          </div>
          <small>Each length is planned separately, so the short one isn't just the long one cut off.</small>
        </div>
        <div className="field">
          <span>Opening hook options</span>
          <Seg value={String(hookOptions) as "1" | "2" | "3"} onChange={(v) => setHookOptions(Number(v) as 1 | 2 | 3)} label="Hook options" options={[["1", "One"], ["2", "Two"], ["3", "Three"]]} />
          <small>Get the main reel with 2 or 3 different opening lines, to test which one people stop for.</small>
        </div>
      </details>
      <details className="subpanel">
        <summary>Watermark and end card for this video</summary>
        <BrandingEditor value={branding} onChange={setBranding} handle={studio.settings.brand.handle} logo={logoUrl} />
        <button type="button" className="btn quiet small" onClick={() => setBranding(brandingFromSettings(studio.settings))}>
          Reset to my defaults
        </button>
      </details>
      <details className="subpanel">
        <summary>Text style for this video</summary>
        <CaptionEditor value={captionChoice} onChange={setCaptionChoice} accent={studio.settings.brand.accentColor} />
        <button type="button" className="btn quiet small" onClick={() => setCaptionChoice(captionChoiceFromSettings(studio.settings))}>
          Reset to my defaults
        </button>
      </details>
      <details className="subpanel">
        <summary>Picture and sound fixes</summary>
        <label className="check">
          <input type="checkbox" checked={autoColor} onChange={(e) => setAutoColor(e.target.checked)} />
          <span>
            Fix light and colour
            <br />
            <small className="hint">Brightens dark rooms, tames blown-out walls, warms up cold skin tones.</small>
          </span>
        </label>
        <div className="field">
          <span>Steady shaky video</span>
          <Seg value={stabilize} onChange={setStabilize} label="Stabilize" options={[["auto", "When needed"], ["on", "Always"], ["off", "Never"]]} />
        </div>
        <label className="check">
          <input type="checkbox" checked={cleanAudio} onChange={(e) => setCleanAudio(e.target.checked)} />
          <span>
            Clean up the sound
            <br />
            <small className="hint">Removes hum and hiss, makes voices clearer, evens out loud and quiet parts.</small>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={qualityCheck} onChange={(e) => setQualityCheck(e.target.checked)} />
          <span>
            Double-check the finished reel
            <br />
            <small className="hint">Claude watches the result and fixes problems once before you get it. Adds 2-4 minutes.</small>
          </span>
        </label>
      </details>
      <label className="check">
        <input type="checkbox" checked={alsoCarousel} onChange={(e) => setAlsoCarousel(e.target.checked)} />
        <span>
          Also make a matching carousel from this video
          <br />
          <small className="hint">Same message, second format: the key points as swipeable slides.</small>
        </span>
      </label>
      <div className="row">
        <button className="btn primary" disabled={busy || uploading || ready.length === 0}>
          {uploading ? "Waiting for uploads…" : busy ? "Queuing…" : "Make my reel"}
        </button>
        {ready.length === 0 ? <span className="hint">Add at least one video or photo first.</span> : null}
      </div>
    </form>
  );
}

function VerseForm() {
  const { studio, toast, go, refresh } = useApp();
  const s = studio.settings;
  const [count, setCount] = useState(Math.max(1, s.auto.reelsPerDay));
  const [theme, setTheme] = useState("");
  const [language, setLanguage] = useState<Language>("english");
  const [preset, setPreset] = useState<Preset | "auto">("auto");
  const [refs, setRefs] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const references = refs.split(/\n|;/).map((r) => r.trim()).filter(Boolean).slice(0, 20);
          await queueJob(studio.folders, {
            type: "verse",
            count: references.length || count,
            theme,
            language,
            preset,
            references,
            instructions,
          });
          toast("Queued. Your reels will appear under Reels.");
          void refresh();
          go("today");
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid2">
        <label className="field">
          <span>How many reels</span>
          <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <div className="field">
          <span>Language</span>
          <Seg value={language} onChange={setLanguage} label="Language" options={[["english", "English"], ["telugu", "Telugu"], ["mixed", "Mix"]]} />
        </div>
      </div>
      <label className="field">
        <span>Theme (optional)</span>
        <input type="text" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="e.g. Peace when you're anxious" />
        <div className="row" style={{ marginTop: 4 }}>
          {s.auto.themes.slice(0, 6).map((t) => (
            <button type="button" key={t} className="btn small" onClick={() => setTheme(t)}>
              {t}
            </button>
          ))}
        </div>
      </label>
      <div className="field">
        <span>Look</span>
        <StylePicker value={preset} onChange={setPreset} allowPhoto />
        <small>“My backgrounds” uses the photos and clips in Library. “Stock footage” finds a free matching video on Pixabay.</small>
      </div>
      <label className="field">
        <span>Specific verses (optional)</span>
        <textarea style={{ minHeight: 70 }} value={refs} onChange={(e) => setRefs(e.target.value)} placeholder={"One per line, e.g.\nPsalm 23:1\nJohn 14:27"} />
        <small>Leave empty and Claude picks verses that haven't been used recently.</small>
      </label>
      <label className="field">
        <span>Anything else for Claude (optional)</span>
        <input type="text" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. for people grieving a loss" />
      </label>
      <div>
        <button className="btn primary" disabled={busy}>
          {busy ? "Queuing…" : `Make ${refs.trim() ? "these" : count} reel${count > 1 || refs.includes("\n") ? "s" : ""}`}
        </button>
      </div>
    </form>
  );
}

function CarouselForm() {
  const { studio, toast, go, refresh } = useApp();
  const [topic, setTopic] = useState("");
  const [slides, setSlides] = useState(5);
  const [language, setLanguage] = useState<Language>("english");
  const [preset, setPreset] = useState<Preset | "auto">("auto");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await queueJob(studio.folders, { type: "carousel", topic, slides, language, preset });
          toast("Queued. Your carousel will appear under Reels.");
          void refresh();
          go("today");
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Topic</span>
        <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Stillness isn't weakness" />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Slides: {slides}</span>
          <input type="range" min={3} max={10} value={slides} onChange={(e) => setSlides(Number(e.target.value))} />
        </label>
        <div className="field">
          <span>Language</span>
          <Seg value={language} onChange={setLanguage} label="Language" options={[["english", "English"], ["telugu", "Telugu"], ["mixed", "Mix"]]} />
        </div>
      </div>
      <div className="field">
        <span>Look</span>
        <StylePicker value={preset} onChange={setPreset} allowPhoto={false} />
      </div>
      <div>
        <button className="btn primary" disabled={busy}>
          {busy ? "Queuing…" : "Make the carousel"}
        </button>
      </div>
    </form>
  );
}

export function Make({ initial = "verse" }: { initial?: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  useEffect(() => setMode(initial), [initial]);
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Make something</h1>
          <p>Everything is made on the studio computer and lands under Reels, usually within a few minutes.</p>
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Seg value={mode} onChange={setMode} label="What to make" options={[["verse", "Verse reels"], ["edit", "Edit my videos"], ["carousel", "Carousel"]]} />
      </div>
      <div className="panel">{mode === "verse" ? <VerseForm /> : mode === "edit" ? <EditForm /> : <CarouselForm />}</div>
    </>
  );
}
