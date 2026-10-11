import React, { useEffect, useRef, useState } from "react";
import { PRESETS, type Preset, type Settings } from "@shared/schema";
import { useApp } from "../App";
import * as g from "../google";
import { PRESET_INFO } from "./Make";

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

export function SettingsView() {
  const { studio, saveSettings, toast } = useApp();
  const [s, setS] = useState<Settings>(() => structuredClone(studio.settings));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(studio.settings);
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
        <Section title="Auto mode" desc="The studio computer makes new reels every day on its own and puts them under Reels for you to download.">
          <label className="check">
            <input type="checkbox" checked={s.auto.enabled} onChange={(e) => set((x) => void (x.auto.enabled = e.target.checked))} />
            <span style={{ fontWeight: 600 }}>Make content automatically every day</span>
          </label>
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

        <Section title="Signature" desc="Your name or handle on every video and slide.">
          <div className="grid2">
            <label className="field">
              <span>Signature text</span>
              <input type="text" value={s.brand.signatureText} onChange={(e) => set((x) => void (x.brand.signatureText = e.target.value))} />
            </label>
            <label className="field">
              <span>Instagram handle</span>
              <input type="text" value={s.brand.handle} onChange={(e) => set((x) => void (x.brand.handle = e.target.value))} />
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Position</span>
              <select value={s.brand.watermarkPosition} onChange={(e) => set((x) => void (x.brand.watermarkPosition = e.target.value as Settings["brand"]["watermarkPosition"]))}>
                <option value="bottom-center">Bottom, centered</option>
                <option value="bottom-left">Bottom left</option>
                <option value="top-left">Top left</option>
                <option value="top-center">Top, centered</option>
                <option value="top-right">Top right</option>
              </select>
            </label>
            <label className="field">
              <span>Visibility: {Math.round(s.brand.watermarkOpacity * 100)}%</span>
              <input type="range" min={0.2} max={1} step={0.05} value={s.brand.watermarkOpacity} onChange={(e) => set((x) => void (x.brand.watermarkOpacity = Number(e.target.value)))} />
            </label>
          </div>
          <div className="grid2">
            <label className="field">
              <span>Highlight colour</span>
              <input type="color" value={s.brand.accentColor} onChange={(e) => set((x) => void (x.brand.accentColor = e.target.value))} style={{ width: 64, height: 42, border: 0, background: "none" }} />
              <small>Used for highlighted words and the verse reference.</small>
            </label>
            <LogoField s={s} set={set} />
          </div>
          <label className="check">
            <input type="checkbox" checked={s.brand.outro.enabled} onChange={(e) => set((x) => void (x.brand.outro.enabled = e.target.checked))} />
            <span>End each reel with a short “follow” card</span>
          </label>
          {s.brand.outro.enabled ? (
            <label className="field">
              <span>Closing card text</span>
              <input type="text" value={s.brand.outro.text} onChange={(e) => set((x) => void (x.brand.outro.text = e.target.value))} />
            </label>
          ) : null}
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
          <div className="field">
            <span>On-video captions for edited clips</span>
            <div className="seg" role="group" aria-label="Caption style">
              {(["karaoke", "lines", "none"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={s.captions.onVideoStyle === v} onClick={() => set((x) => void (x.captions.onVideoStyle = v))}>
                  {v === "karaoke" ? "Word by word" : v === "lines" ? "Whole lines" : "None"}
                </button>
              ))}
            </div>
          </div>
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

        <Section title="Advanced">
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
