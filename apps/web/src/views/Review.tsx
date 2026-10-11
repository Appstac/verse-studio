// Rating, notes and quick changes for one finished reel or carousel.
import React, { useEffect, useState } from "react";
import { FEEDBACK_TAGS, PRESETS, outputKey, type Job, type OutputItem, type Preset, type ReviseChanges } from "@shared/schema";
import { useApp } from "../App";
import { loadSpec, queueRevision, saveFeedback } from "../studio";
import { PRESET_INFO } from "./Make";

function Stars({ value, onChange }: { value?: number; onChange: (n: number) => void }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={value && n <= value ? "on" : ""}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function RatePanel({ job, o, preset, onDone }: { job: Job; o: OutputItem; preset?: string; onDone: () => void }) {
  const { studio, toast, refresh } = useApp();
  const existing = studio.feedback.get(outputKey(job.id, o));
  const [rating, setRating] = useState<number | undefined>(existing?.fb.rating);
  const [tags, setTags] = useState<string[]>(existing?.fb.tags ?? []);
  const [note, setNote] = useState(existing?.fb.note ?? "");
  const [remember, setRemember] = useState(existing?.fb.remember ?? true);
  const [busy, setBusy] = useState(false);
  const toggle = (t: string) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Stars value={rating} onChange={setRating} />
      <div className="chips">
        {FEEDBACK_TAGS.good.map((t) => (
          <button key={t} type="button" className={`chip good ${tags.includes(t) ? "on" : ""}`} aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>
            {t}
          </button>
        ))}
        {FEEDBACK_TAGS.bad.map((t) => (
          <button key={t} type="button" className={`chip bad ${tags.includes(t) ? "on" : ""}`} aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>
            {t}
          </button>
        ))}
      </div>
      <textarea
        style={{ minHeight: 70 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What should be different next time? e.g. Hooks should be questions. Use Telugu worship songs for edits."
        aria-label="Notes"
      />
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          Remember this for future videos
          <br />
          <small className="hint">The studio learns from your ratings and notes and follows them next time.</small>
        </span>
      </label>
      <div className="row">
        <button
          type="button"
          className="btn small primary"
          disabled={busy || (!rating && !tags.length && !note.trim())}
          onClick={async () => {
            setBusy(true);
            try {
              await saveFeedback(studio.folders, job, o, { rating, tags, note, remember, preset }, existing?.fileId);
              toast(remember ? "Saved. The studio will learn from it." : "Saved");
              void refresh();
              onDone();
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save feedback"}
        </button>
      </div>
    </div>
  );
}

const QUICK_IDEAS: Record<string, string[]> = {
  verse: ["Make the hook a question", "Pick a more comforting verse", "Shorter caption", "Write it in Telugu"],
  edit: ["Start with the strongest moment", "Keep the whole chorus", "Fewer cuts, longer shots", "Make it 15 seconds"],
  carousel: ["Make the cover more personal", "Add one more scripture slide", "Shorter text on each slide"],
};

function ChangePanel({ job, o, spec, onDone }: { job: Job; o: OutputItem; spec: Record<string, any> | null; onDone: () => void }) {
  const { studio, toast, refresh } = useApp();
  const source: string = spec?.source ?? o.source ?? "verse";
  const [hook, setHook] = useState<string>("");
  const [verseText, setVerseText] = useState<string>("");
  const [caption, setCaption] = useState(o.caption);
  const [preset, setPreset] = useState<Preset | "">("");
  const [speed, setSpeed] = useState<"slower" | "normal" | "faster">("normal");
  const [captions, setCaptions] = useState<"" | "on" | "off">("");
  const [layout, setLayout] = useState<"" | "fill" | "blur-pad">("");
  const [slides, setSlides] = useState<Array<{ title: string; body: string }>>([]);
  const [instruction, setInstruction] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!spec) return;
    if (spec.source === "verse") {
      setHook(spec.item?.hook ?? "");
      setVerseText(spec.text ?? "");
    } else if (spec.source === "edit") setHook(spec.plan?.hook ?? "");
    else if (spec.source === "carousel") setSlides((spec.slides ?? []).map((s: any) => ({ title: s.title ?? "", body: s.body ?? "" })));
  }, [spec]);

  if (!o.specFileId) return <p className="hint">Quick changes work on videos made from now on.</p>;
  if (!spec) return <p className="hint">Loading…</p>;

  const submit = async () => {
    const ch: ReviseChanges = {};
    if (source === "verse") {
      if (hook !== (spec.item?.hook ?? "")) ch.hook = hook;
      if (verseText !== (spec.text ?? "")) ch.verseText = verseText;
    }
    if (source === "edit") {
      if (hook !== (spec.plan?.hook ?? "")) ch.hook = hook;
      if (captions) ch.captions = captions;
      if (layout) ch.layout = layout;
    }
    if (source === "carousel") {
      const orig = (spec.slides ?? []).map((s: any) => ({ title: s.title ?? "", body: s.body ?? "" }));
      if (JSON.stringify(orig) !== JSON.stringify(slides)) ch.slides = slides;
    }
    if (caption !== o.caption) ch.caption = caption;
    if (preset) ch.preset = preset;
    if (speed !== "normal") ch.speed = speed;
    if (!Object.keys(ch).length && !instruction.trim()) {
      toast("Change something first");
      return;
    }
    setBusy(true);
    try {
      await queueRevision(studio.folders, job, o, ch, instruction.trim(), remember);
      if (remember && instruction.trim()) {
        await saveFeedback(studio.folders, job, o, { tags: [], note: `Asked for a change: ${instruction.trim()}`, remember: true, preset: spec.preset });
      }
      toast("Making the new version. It will appear at the top of Reels.");
      void refresh();
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <label className="field">
        <span>Tell Claude what to change</span>
        <textarea
          style={{ minHeight: 70 }}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={source === "edit" ? "e.g. Cut the first 3 seconds, keep the whole chorus, end on the group hug" : "e.g. Make the hook warmer and the reveal slower"}
        />
      </label>
      <div className="chips">
        {(QUICK_IDEAS[source] ?? []).map((t) => (
          <button key={t} type="button" className="chip" onClick={() => setInstruction((x) => (x ? `${x}. ${t}` : t))}>
            {t}
          </button>
        ))}
      </div>
      <details>
        <summary className="hint" style={{ cursor: "pointer" }}>
          Or change things yourself (instant, no AI)
        </summary>
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          {source !== "carousel" ? (
            <label className="field">
              <span>Hook</span>
              <input type="text" value={hook} onChange={(e) => setHook(e.target.value)} />
            </label>
          ) : null}
          {source === "verse" ? (
            <label className="field">
              <span>Verse text</span>
              <textarea style={{ minHeight: 80 }} value={verseText} onChange={(e) => setVerseText(e.target.value)} />
            </label>
          ) : null}
          {source === "carousel"
            ? slides.map((sl, i) => (
                <div key={i} className="field">
                  <span>Slide {i + 1}</span>
                  <input type="text" value={sl.title} onChange={(e) => setSlides((x) => x.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
                  <textarea
                    style={{ minHeight: 56 }}
                    value={sl.body}
                    onChange={(e) => setSlides((x) => x.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)))}
                  />
                </div>
              ))
            : null}
          {source !== "edit" ? (
            <div className="field">
              <span>Look</span>
              <div className="chips">
                {PRESETS.filter((p) => source === "verse" || p !== "photo").map((p) => (
                  <button key={p} type="button" className={`chip ${preset === p ? "on" : ""}`} aria-pressed={preset === p} onClick={() => setPreset(preset === p ? "" : p)}>
                    {PRESET_INFO[p].label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {source !== "carousel" ? (
            <div className="field">
              <span>Pace</span>
              <div className="seg tight" role="group" aria-label="Pace">
                {(["slower", "normal", "faster"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)}>
                    {v === "normal" ? "Same" : v[0].toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {source === "edit" ? (
            <div className="grid2">
              <div className="field">
                <span>Captions</span>
                <div className="seg tight" role="group" aria-label="Captions">
                  {([["", "Same"], ["on", "On"], ["off", "Off"]] as const).map(([v, l]) => (
                    <button key={l} type="button" aria-pressed={captions === v} onClick={() => setCaptions(v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>Framing</span>
                <div className="seg tight" role="group" aria-label="Framing">
                  {([["", "Same"], ["fill", "Fill"], ["blur-pad", "Whole frame"]] as const).map(([v, l]) => (
                    <button key={l} type="button" aria-pressed={layout === v} onClick={() => setLayout(v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <label className="field">
            <span>Instagram caption</span>
            <textarea style={{ minHeight: 80 }} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
        </div>
      </details>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Do this for future videos too</span>
      </label>
      <div>
        <button type="button" className="btn small primary" disabled={busy} onClick={submit}>
          {busy ? "Queuing…" : "Make new version"}
        </button>
      </div>
    </div>
  );
}

export function ReviewTools({ job, o }: { job: Job; o: OutputItem }) {
  const { studio } = useApp();
  const [open, setOpen] = useState<"" | "rate" | "change">("");
  const [spec, setSpec] = useState<Record<string, any> | null>(null);
  const fb = studio.feedback.get(outputKey(job.id, o))?.fb;
  useEffect(() => {
    if (open === "change" && o.specFileId && !spec) loadSpec(o.specFileId).then(setSpec).catch(() => setSpec({}));
  }, [open, o.specFileId, spec]);
  const preset = spec?.preset;
  return (
    <div className="review">
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className={`btn small ${open === "rate" ? "primary" : ""}`} aria-expanded={open === "rate"} onClick={() => setOpen(open === "rate" ? "" : "rate")}>
          {fb?.rating ? `${"★".repeat(fb.rating)}` : "Rate"}
        </button>
        <button type="button" className={`btn small ${open === "change" ? "primary" : ""}`} aria-expanded={open === "change"} onClick={() => setOpen(open === "change" ? "" : "change")}>
          Change
        </button>
      </div>
      {open === "rate" ? (
        <div className="drawer">
          <RatePanel job={job} o={o} preset={preset} onDone={() => setOpen("")} />
        </div>
      ) : null}
      {open === "change" ? (
        <div className="drawer">
          <ChangePanel job={job} o={o} spec={spec} onDone={() => setOpen("")} />
        </div>
      ) : null}
    </div>
  );
}
