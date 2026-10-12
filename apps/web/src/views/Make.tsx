import React, { useEffect, useRef, useState } from "react";
import {
  PRESETS,
  QUALITY_LABEL,
  allStyles,
  brandingFromSettings,
  captionChoiceFromSettings,
  type Branding,
  type CaptionChoice,
  type EditDefaults,
  type EditType,
  type Language,
  type Preset,
  type StylePreset,
  MEDIA_PRESETS,
} from "@shared/schema";
import { useApp } from "../App";
import * as g from "../google";
import { queueJob } from "../studio";
import { EditOptions } from "./EditOptions";

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
  auto: "Claude looks and listens, then picks the right approach.",
  worship: "Keeps whole sung lines and continuous sound, lyrics on screen, no music on top of the singing.",
  talking: "Keeps the best take, removes pauses and retakes, clean captions.",
  sermon: "Finds the strongest moment (or keeps the full message on YouTube), clean subtitles, calm pacing.",
  montage: "The best moments first, varied shots, cut on the music's beat.",
};

// Pick a saved style (or start from defaults), see every choice, change anything, send.
function EditForm() {
  const { studio, toast, go, refresh, saveSettings } = useApp();
  const s = studio.settings;
  const styles = allStyles(s);
  const [styleId, setStyleId] = useState<string>(styles.some((x) => x.id === s.defaultStyleId) ? s.defaultStyleId : "defaults");
  const fromStyle = (id: string) => {
    const st = styles.find((x) => x.id === id);
    return {
      opts: structuredClone(st ? st.edit : s.edit),
      caption: structuredClone(st?.captionChoice ?? captionChoiceFromSettings(s)),
      branding: structuredClone(st?.branding ?? brandingFromSettings(s)),
    };
  };
  const [opts, setOpts] = useState<EditDefaults>(() => fromStyle(styleId).opts);
  const [captionChoice, setCaptionChoice] = useState<CaptionChoice>(() => fromStyle(styleId).caption);
  const [branding, setBranding] = useState<Branding>(() => fromStyle(styleId).branding);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [singer, setSinger] = useState("");
  const [eventName, setEventName] = useState(() => fromStyle(styleId).opts.eventName);
  const [credits, setCredits] = useState("");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = uploads.filter((u) => u.fileId);
  const uploading = uploads.some((u) => !u.fileId && !u.error);
  const song = opts.editType === "worship" || opts.editType === "auto";
  const yt = opts.format === "youtube";

  const applyStyle = (id: string) => {
    setStyleId(id);
    const f = fromStyle(id);
    setOpts(f.opts);
    setCaptionChoice(f.caption);
    setBranding(f.branding);
    if (f.opts.eventName) setEventName(f.opts.eventName);
  };

  const saveAsStyle = async () => {
    const name = window.prompt("Name this style (e.g. Sunday sermon clip)")?.trim();
    if (!name) return;
    const id = `mine-${Date.now().toString(36)}`;
    const preset: StylePreset = { id, name, description: "Saved from Make → Edit", edit: { ...opts, eventName }, captionChoice, branding };
    await saveSettings({ ...s, stylePresets: [...s.stylePresets, preset] });
    setStyleId(id);
    toast(`Saved "${name}". It's in the style list from now on.`);
  };

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
            targetSeconds: yt ? opts.youtubeSeconds : opts.defaultSeconds,
            format: opts.format,
            fullLength: yt && opts.fullLength,
            layout: opts.layout,
            captions: opts.captions,
            captionLanguage: opts.captionLanguage,
            keepOriginalAudio: opts.keepOriginalAudio,
            alsoCarousel: opts.alsoCarousel,
            editType: opts.editType,
            editStyle: opts.editStyle,
            quality: opts.quality,
            relight: opts.relight,
            background: opts.background,
            effects: opts.effects,
            titleStyle: opts.titleStyle,
            eventName: eventName.trim(),
            credits: credits.trim(),
            lyrics: song ? lyrics.trim() : "",
            songTitle: song ? songTitle.trim() : "",
            singer: song ? singer.trim() : "",
            focus: focus.trim(),
            stabilize: opts.stabilize,
            cleanAudio: opts.cleanAudio,
            autoColor: opts.autoColor,
            qualityCheck: opts.qualityCheck,
            ranges: ready
              .map((u, index) => ({ index, start: u.start ?? 0, end: u.end ?? u.duration ?? 99999 }))
              .filter((r, i) => (ready[i].start !== undefined || ready[i].end !== undefined) && r.end > r.start + 0.5),
            extraLengths: opts.extraLengths.filter((l) => Math.abs(l - (yt ? opts.youtubeSeconds : opts.defaultSeconds)) >= 3),
            hookOptions: opts.hookOptions,
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
      <div className="field">
        <span>Style</span>
        <div className="style-grid">
          {[{ id: "defaults", name: "My defaults", description: "Your choices from Settings → Edit defaults" }, ...styles].map((st) => (
            <button key={st.id} type="button" className={`style-card ${styleId === st.id ? "on" : ""}`} onClick={() => applyStyle(st.id)}>
              <b>{st.name}</b>
              <small>{st.description}</small>
            </button>
          ))}
        </div>
        <small>A style fills in every choice below. Change anything you like before sending.</small>
      </div>

      <Uploader uploads={uploads} setUploads={setUploads} />
      <label className="field">
        <span>What should the video be?</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A reel of our October worship night. Open on the chorus of Jesus What a Savior, show the band and people singing, end on the group."
        />
        <small>{EDIT_TYPE_HINT[opts.editType]}</small>
      </label>

      {song || opts.effects.titles.includes("poster") || opts.effects.titles.includes("recap") || opts.effects.extras.includes("story") ? (
        <details className="subpanel" open={opts.editType === "worship"}>
          <summary>Song and event details (makes worship videos much better)</summary>
          <div className="grid2">
            <label className="field">
              <span>Song title</span>
              <input type="text" value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="e.g. Jesus What a Savior" />
            </label>
            <label className="field">
              <span>Sung by / original artist</span>
              <input type="text" value={singer} onChange={(e) => setSinger(e.target.value)} placeholder="e.g. Housefires" />
            </label>
          </div>
          <label className="field">
            <span>Event or ministry name</span>
            <input type="text" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Worship Circle" />
            <small>Shown on poster title cards and in closing quotes.</small>
          </label>
          <label className="field">
            <span>Lyrics</span>
            <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Paste the lyrics, one line per line (Telugu or English). They appear in time with the singing." style={{ minHeight: 120 }} />
          </label>
          <label className="field">
            <span>Credits for the caption</span>
            <textarea value={credits} onChange={(e) => setCredits(e.target.value)} placeholder={"Lead vox: Jessy\nDrums: Jeevan\nKeys: Enoch"} style={{ minHeight: 70 }} />
          </label>
        </details>
      ) : null}

      <label className="field">
        <span>Who should stay in frame? (optional)</span>
        <input type="text" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. the pastor in the blue shirt" />
      </label>

      <EditOptions value={opts} onChange={setOpts} branding={branding} setBranding={setBranding} captionChoice={captionChoice} setCaptionChoice={setCaptionChoice} />

      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn primary" disabled={busy || uploading || ready.length === 0}>
          {uploading ? "Waiting for uploads…" : busy ? "Queuing…" : yt ? "Make my YouTube video" : "Make my reel"}
        </button>
        <button type="button" className="btn quiet" onClick={saveAsStyle}>
          Save these choices as a style
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
  const [shape, setShape] = useState<"reel" | "youtube" | "both">(s.auto.format);
  const [quality, setQuality] = useState(s.auto.quality);
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
            format: shape === "youtube" ? "youtube" : "reel",
            bothFormats: shape === "both",
            quality,
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
        <div className="field">
          <span>Shape</span>
          <Seg value={shape} onChange={setShape} label="Shape" options={[["reel", "Reel 9:16"], ["youtube", "YouTube 16:9"], ["both", "Both"]]} />
        </div>
        <label className="field">
          <span>Quality</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            {(Object.keys(QUALITY_LABEL) as Array<keyof typeof QUALITY_LABEL>).map((q) => (
              <option key={q} value={q}>
                {QUALITY_LABEL[q]}
              </option>
            ))}
          </select>
        </label>
      </div>
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
