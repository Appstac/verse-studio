import React, { useEffect, useRef, useState } from "react";
import { PRESETS, QUALITY_LABEL, allStyles, brandingFromSettings, type Preset, type Settings } from "@shared/schema";
import { EditOptions } from "./EditOptions";
import { useApp } from "../App";
import * as g from "../google";
import { PRESET_INFO } from "./Make";
import { loadLearned, queueJob, saveLearned } from "../studio";
import { StudioComputerSection } from "./StudioComputer";
import { BrandingEditor, CaptionEditor, useLogoUrl } from "./StyleEditors";

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="panel stack">
      <div>
        <h2>{title}</h2>
        {desc ? <p className="muted" style={{ marginTop: 6 }}>{desc}</p> : null}
      </div>
      {children}
    </section>
  );
}

const TIMEZONES = ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "Asia/Kolkata", "Europe/London", "UTC"];

function LogoField({ s, set }: { s: Settings; set: (f: (s: Settings) => void) => void }) {
  const { studio, toast } = useApp();
  const [url, setUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (s.brand.logoFileId) g.objectUrl(s.brand.logoFileId).then(setUrl).catch(() => setUrl(undefined));
    else setUrl(undefined);
  }, [s.brand.logoFileId]);
  return (
    <div className="field">
      <span>Logo or profile photo (optional)</span>
      <div className="row">
        {url ? <img src={url} alt="" style={{ width: 56, height: 56, borderRadius: 28, objectFit: "cover" }} /> : null}
        <button className="btn small" type="button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : url ? "Change" : "Upload"}
        </button>
        {url ? (
          <button className="btn quiet small" type="button" onClick={() => set((x) => void (x.brand.logoFileId = undefined))}>
            Remove
          </button>
        ) : null}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            try {
              const id = await g.uploadFile(f, studio.folders.Brand);
              set((x) => void (x.brand.logoFileId = id));
            } catch (err) {
              toast(err instanceof Error ? err.message : "Upload failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      <small>Shown next to the signature and on the closing card. A square PNG works best.</small>
    </div>
  );
}

function LearnedSection() {
  const { studio, toast, refresh } = useApp();
  const [doc, setDoc] = useState<{ id?: string; text: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadLearned(studio.folders)
      .then((d) => {
        setDoc(d);
        setText(d.text);
      })
      .catch(() => setDoc({ text: "" }));
  }, [studio.folders]);
  const ratings = [...studio.feedback.values()].filter((x) => x.fb.rating);
  const avg = ratings.length ? (ratings.reduce((a, x) => a + (x.fb.rating ?? 0), 0) / ratings.length).toFixed(1) : null;
  return (
    <Section
      title="What the studio has learned"
      desc="Built from your ratings, notes and remembered change requests. Every new video follows it. It's saved in your Google Drive, so it survives restarts and new computers."
    >
      <p className="hint">
        {studio.feedback.size} feedback item{studio.feedback.size === 1 ? "" : "s"}
        {avg ? `, average rating ${avg}★` : ""}. New feedback is folded in automatically when the studio computer is idle.
      </p>
      {doc === null ? (
        <p className="hint">Loading…</p>
      ) : (
        <textarea
          className="learned"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nothing learned yet. Rate a few videos under Reels, or write your own rules here, e.g. Hooks: short questions. Never use the Bold look."
          aria-label="Learned style guide"
        />
      )}
      <div className="row">
        <button
          className="btn small primary"
          disabled={busy || doc === null || text === doc.text}
          onClick={async () => {
            setBusy(true);
            try {
              await saveLearned(studio.folders, text, doc?.id);
              setDoc({ id: doc?.id, text });
              toast("Saved. New videos will follow it.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Save my edits
        </button>
        <button
          className="btn small"
          disabled={!studio.feedback.size}
          onClick={async () => {
            await queueJob(studio.folders, { type: "learn" });
            toast("Relearning from all your feedback");
            void refresh();
          }}
        >
          Relearn now
        </button>
      </div>
    </Section>
  );
}

export function SettingsView() {
  const { studio, saveSettings, toast } = useApp();
  const [s, setS] = useState<Settings>(() => structuredClone(studio.settings));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(studio.settings);
  const logoUrl = useLogoUrl(s.brand.logoFileId);
  const set = (f: (x: Settings) => void) =>
    setS((prev) => {
      const next = structuredClone(prev);
      f(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings(s);
      toast("Settings saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const togglePreset = (p: Preset) =>
    set((x) => {
      const has = x.auto.presets.includes(p);
      x.auto.presets = has ? x.auto.presets.filter((y) => y !== p) : [...x.auto.presets, p];
      if (!x.auto.presets.length) x.auto.presets = ["night"];
    });

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Settings</h1>
          <p>Changes apply to the next video the studio makes.</p>
        </div>
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>
      <div className="stack" style={{ gap: 22 }}>
        <StudioComputerSection />

        <Section title="Auto mode" desc="The studio computer makes new reels every day on its own and puts them under Reels for you to download.">
          <label className="check">
            <input type="checkbox" checked={s.auto.enabled} onChange={(e) => set((x) => void (x.auto.enabled = e.target.checked))} />
            <span style={{ fontWeight: 600 }}>Make content automatically every day</span>
          </label>
          <div className="grid2">
            <div className="field">
              <span>Shape of auto videos</span>
              <div className="seg" role="group" aria-label="Auto shape">
                {(
                  [
                    ["reel", "Reels (vertical)"],
                    ["youtube", "YouTube (horizontal)"],
                    ["both", "Both"],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={s.auto.format === v} onClick={() => set((x) => void (x.auto.format = v))}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Quality of auto videos</span>
              <select value={s.auto.quality} onChange={(e) => set((x) => void (x.auto.quality = e.target.value as Settings["auto"]["quality"]))}>
                {(Object.keys(QUALITY_LABEL) as Array<keyof typeof QUALITY_LABEL>).map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_LABEL[q]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid3">
            <label className="field">
              <span>Reels per day</span>
              <input type="number" min={0} max={20} value={s.auto.reelsPerDay} onChange={(e) => set((x) => void (x.auto.reelsPerDay = Math.max(0, Math.min(20, Number(e.target.value) || 0))))} />
            </label>
            <label className="field">
              <span>Carousels per week</span>
              <input type="number" min={0} max={7} value={s.auto.carouselsPerWeek} onChange={(e) => set((x) => void (x.auto.carouselsPerWeek = Math.max(0, Math.min(7, Number(e.target.value) || 0))))} />
            </label>
            <label className="field">
              <span>Make them at</span>
              <input type="time" value={s.auto.runAt} onChange={(e) => set((x) => void (x.auto.runAt = e.target.value || "05:30"))} />
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Time zone</span>
              <select value={s.auto.timezone} onChange={(e) => set((x) => void (x.auto.timezone = e.target.value))}>
                {[...new Set([s.auto.timezone, ...TIMEZONES])].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Telugu share: {s.auto.teluguPercent}%</span>
              <input type="range" min={0} max={100} step={10} value={s.auto.teluguPercent} onChange={(e) => set((x) => void (x.auto.teluguPercent = Number(e.target.value)))} />
              <small>The rest are English.</small>
            </label>
          </div>
          <div className="field">
            <span>Before they're ready</span>
            <div className="seg" role="group" aria-label="Approval">
              <button type="button" aria-pressed={s.auto.approval === "auto"} onClick={() => set((x) => void (x.auto.approval = "auto"))}>
                Show them straight away
              </button>
              <button type="button" aria-pressed={s.auto.approval === "review"} onClick={() => set((x) => void (x.auto.approval = "review"))}>
                Ask me to approve
              </button>
            </div>
          </div>
          <label className="field">
            <span>Themes to rotate through</span>
            <textarea value={s.auto.themes.join("\n")} onChange={(e) => set((x) => void (x.auto.themes = e.target.value.split("\n").map((t) => t.trim()).filter(Boolean)))} />
            <small>One per line.</small>
          </label>
          <div className="field">
            <span>Looks to use</span>
            <div className="row">
              {PRESETS.map((p) => (
                <label key={p} className="check" style={{ alignItems: "center" }}>
                  <input type="checkbox" checked={s.auto.presets.includes(p)} onChange={() => togglePreset(p)} />
                  <span className="row" style={{ gap: 6 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: PRESET_INFO[p].swatch, border: "1px solid var(--line)" }} />
                    {PRESET_INFO[p].label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Bible translation (English)</span>
              <select value={s.auto.translation} onChange={(e) => set((x) => void (x.auto.translation = e.target.value as Settings["auto"]["translation"]))}>
                <option value="web">World English Bible (WEB)</option>
                <option value="kjv">King James Version (KJV)</option>
                <option value="asv">American Standard Version (ASV)</option>
                <option value="bbe">Bible in Basic English (BBE)</option>
              </select>
              <small>Public-domain translations, so verse text is quoted exactly.</small>
            </label>
            <label className="field">
              <span>Don't repeat a verse for (days)</span>
              <input type="number" min={0} max={3650} value={s.auto.avoidRepeatDays} onChange={(e) => set((x) => void (x.auto.avoidRepeatDays = Math.max(0, Number(e.target.value) || 0)))} />
            </label>
          </div>
          <label className="field">
            <span>Notes for Claude</span>
            <textarea style={{ minHeight: 80 }} value={s.auto.extraInstructions} onChange={(e) => set((x) => void (x.auto.extraInstructions = e.target.value))} placeholder="e.g. Speak to young women. Mention Telugu worship songs sometimes." />
          </label>
        </Section>

        <Section title="Signature, watermark and end card" desc="Defaults for every video and slide. You can still change them for a single video before sending it.">
          <div className="grid2">
            <label className="field">
              <span>Instagram handle</span>
              <input type="text" value={s.brand.handle} onChange={(e) => set((x) => void (x.brand.handle = e.target.value))} />
            </label>
            <label className="field">
              <span>Highlight colour</span>
              <input type="color" value={s.brand.accentColor} onChange={(e) => set((x) => void (x.brand.accentColor = e.target.value))} className="swatch-input" />
              <small>Used for highlighted words, lyric lines and the verse reference.</small>
            </label>
          </div>
          <LogoField s={s} set={set} />
          <BrandingEditor
            value={brandingFromSettings(s)}
            handle={s.brand.handle}
            logo={logoUrl}
            onChange={(b) =>
              set((x) => {
                const w = b.watermark;
                x.brand.watermarkEnabled = w.enabled;
                x.brand.signatureText = w.text;
                x.brand.watermarkFont = w.font;
                x.brand.watermarkSize = w.size;
                x.brand.watermarkPosition = w.position;
                x.brand.watermarkOpacity = w.opacity;
                x.brand.watermarkStyle = w.style;
                x.brand.watermarkColor = w.color;
                x.brand.watermarkShowLogo = w.showLogo;
                const e = b.endCard;
                x.brand.outro = { ...x.brand.outro, enabled: e.enabled, title: e.title === x.brand.handle ? "" : e.title, text: e.text, seconds: e.seconds, showLogo: e.showLogo, claudeWrites: e.claudeWrites };
              })
            }
          />
        </Section>

        <Section title="Text on videos" desc="How captions, lyrics and hooks look on edited videos. Pick a preset, then fine-tune.">
          <CaptionEditor
            value={{ style: s.captions.onVideoStyle, look: s.captions.look }}
            accent={s.brand.accentColor}
            onChange={(c) =>
              set((x) => {
                x.captions.onVideoStyle = c.style;
                x.captions.look = c.look;
              })
            }
          />
        </Section>

        <Section title="Captions and hashtags">
          <label className="field">
            <span>Writing tone</span>
            <input type="text" value={s.captions.tone} onChange={(e) => set((x) => void (x.captions.tone = e.target.value))} />
          </label>
          <label className="field">
            <span>Call to action</span>
            <input type="text" value={s.captions.cta} onChange={(e) => set((x) => void (x.captions.cta = e.target.value))} />
          </label>
          <div className="grid2">
            <label className="field">
              <span>Always include these hashtags</span>
              <input type="text" value={s.captions.alwaysHashtags.join(" ")} onChange={(e) => set((x) => void (x.captions.alwaysHashtags = e.target.value.split(/[\s,]+/).filter(Boolean)))} />
            </label>
            <label className="field">
              <span>Hashtags per post</span>
              <input type="number" min={0} max={5} value={s.captions.hashtagCount} onChange={(e) => set((x) => void (x.captions.hashtagCount = Math.max(0, Math.min(5, Number(e.target.value) || 0))))} />
              <small>Instagram allows up to 5.</small>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.captions.soundEffects} onChange={(e) => set((x) => void (x.captions.soundEffects = e.target.checked))} />
            <span>
              Sound effects on edits
              <br />
              <small className="hint">Soft whooshes on scene changes and a pop when a photo card appears. Skipped for worship videos.</small>
            </span>
          </label>
        </Section>

        <Section title="Sound versions" desc="Each reel comes in these versions so you can pick whichever fits when you post.">
          <div className="grid2">
            {(
              [
                ["original", "Original sound", "For edited clips with singing or speech"],
                ["library", "Library music", "A track from Library music, picked by mood"],
                ["mine", "My music", "A track from My music"],
                ["silent", "No music", "Add trending audio inside Instagram"],
              ] as const
            ).map(([k, label, hint]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={s.music.variants[k]} onChange={(e) => set((x) => void (x.music.variants[k] = e.target.checked))} />
                <span>
                  {label}
                  <br />
                  <small className="hint">{hint}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="grid2">
            <label className="field">
              <span>Music volume under singing: {Math.round(s.music.musicUnderVoice * 100)}%</span>
              <input type="range" min={0.05} max={0.6} step={0.01} value={s.music.musicUnderVoice} onChange={(e) => set((x) => void (x.music.musicUnderVoice = Number(e.target.value)))} />
            </label>
            <label className="field">
              <span>Reel length for verses: {s.reel.minSeconds} to {s.reel.maxSeconds} seconds</span>
              <input type="range" min={10} max={45} value={s.reel.maxSeconds} onChange={(e) => set((x) => void (x.reel.maxSeconds = Number(e.target.value)))} />
            </label>
          </div>
        </Section>

        <LearnedSection />

        <Section title="Edit defaults" desc="What Make → Edit starts with when you choose “My defaults”. Every choice can still be changed per video.">
          <EditOptions value={s.edit} onChange={(v) => set((x) => void (x.edit = v))} />
        </Section>

        <Section title="Styles" desc="Ready-made and saved bundles of every edit choice. Pick one on Make → Edit; save your own from there.">
          <label className="field">
            <span>Style selected when you open Make → Edit</span>
            <select value={s.defaultStyleId} onChange={(e) => set((x) => void (x.defaultStyleId = e.target.value))}>
              <option value="defaults">My defaults</option>
              {allStyles(s).map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </label>
          {s.stylePresets.length ? (
            <div className="files">
              {s.stylePresets.map((st) => (
                <div className="filerow" key={st.id}>
                  <span>{st.name}</span>
                  <button type="button" className="btn quiet small" onClick={() => set((x) => void (x.stylePresets = x.stylePresets.filter((y) => y.id !== st.id)))}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">No saved styles yet. On Make → Edit, set things up and press “Save these choices as a style”.</p>
          )}
        </Section>

        <Section title="Advanced">
          <label className="field">
            <span>Pixabay key (free stock photos, videos and footage)</span>
            <input type="text" value={s.advanced.pixabayKey} onChange={(e) => set((x) => void (x.advanced.pixabayKey = e.target.value.trim()))} placeholder="Paste your key from pixabay.com/api/docs" />
            <small>Free account at pixabay.com, then copy “Your API key” from pixabay.com/api/docs. Used for real photo/video backgrounds and the Stock footage look.</small>
          </label>
          <div className="grid2">
            <label className="field">
              <span>Speech recognition accuracy</span>
              <select value={s.advanced.whisperModel} onChange={(e) => set((x) => void (x.advanced.whisperModel = e.target.value as Settings["advanced"]["whisperModel"]))}>
                <option value="base">Fast</option>
                <option value="small">Balanced</option>
                <option value="medium">Accurate (slower)</option>
                <option value="large-v3-turbo">Most accurate (best for Telugu, slowest)</option>
              </select>
            </label>
            <label className="field">
              <span>Claude model (optional)</span>
              <input type="text" value={s.advanced.claudeModel} onChange={(e) => set((x) => void (x.advanced.claudeModel = e.target.value.trim()))} placeholder="Leave empty for the default" />
              <small>For example “sonnet” to use less of the plan's usage.</small>
            </label>
          </div>
        </Section>
        <div>
          <button className="btn primary" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>
    </>
  );
}
