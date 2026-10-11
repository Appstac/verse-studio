import React, { useEffect, useRef, useState } from "react";
import { PRESETS, type Language, type Preset } from "@shared/schema";
import { useApp } from "../App";
import * as g from "../google";
import { queueJob } from "../studio";

type Mode = "edit" | "verse" | "carousel";

export const PRESET_INFO: Record<Preset, { label: string; swatch: string }> = {
  dawn: { label: "Dawn", swatch: "linear-gradient(180deg,#140b08,#8a4a26,#d58c4c)" },
  night: { label: "Night sky", swatch: "linear-gradient(180deg,#03050f,#1c2a55)" },
  paper: { label: "Paper", swatch: "#F2E8D5" },
  minimal: { label: "Bold", swatch: "#0A0A0B" },
  garden: { label: "Garden", swatch: "linear-gradient(165deg,#0e2416,#7f9c5e)" },
  photo: { label: "My backgrounds", swatch: "repeating-linear-gradient(45deg,#bbb 0 6px,#999 6px 12px)" },
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
      {PRESETS.filter((p) => allowPhoto || p !== "photo").map((p) => (
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
}

function Uploader({ uploads, setUploads }: { uploads: Upload[]; setUploads: React.Dispatch<React.SetStateAction<Upload[]>> }) {
  const { studio } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const add = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
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
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  const [busy, setBusy] = useState(false);
  const ready = uploads.filter((u) => u.fileId);
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
          <small className="hint">Music versions are mixed quietly underneath it.</small>
        </span>
      </label>
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
        <small>“My backgrounds” uses the photos and clips in Library.</small>
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
