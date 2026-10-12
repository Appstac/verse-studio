// Every edit choice in one panel. Used for the defaults in Settings, inside style
// presets, and on Make → Edit (pre-filled, changeable per video).
import React from "react";
import { EDIT_TYPES, QUALITY_LABEL, type Branding, type CaptionChoice, type EditDefaults, type EditType } from "@shared/schema";
import { useApp } from "../App";
import { BackgroundPicker } from "./BackgroundPicker";
import { EffectsPicker } from "./EffectsPicker";
import { BrandingEditor, CaptionEditor, useLogoUrl } from "./StyleEditors";

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
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

export const EDIT_TYPE_LABEL: Record<EditType, string> = {
  auto: "Let Claude tell",
  worship: "Worship song",
  talking: "Talking / testimony",
  sermon: "Sermon",
  montage: "Event montage",
};

const fmtLen = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}` : `${s} s`);

function Group({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="subpanel" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

export function EditOptions({
  value,
  onChange,
  branding,
  setBranding,
  captionChoice,
  setCaptionChoice,
}: {
  value: EditDefaults;
  onChange: (v: EditDefaults) => void;
  branding?: Branding;
  setBranding?: (b: Branding) => void;
  captionChoice?: CaptionChoice;
  setCaptionChoice?: (c: CaptionChoice) => void;
}) {
  const { studio } = useApp();
  const logo = useLogoUrl(studio.settings.brand.logoFileId);
  const set = (p: Partial<EditDefaults>) => onChange({ ...value, ...p });
  const yt = value.format === "youtube";
  const seconds = yt ? value.youtubeSeconds : value.defaultSeconds;
  return (
    <div className="stack">
      <div className="grid2">
        <div className="field">
          <span>Shape</span>
          <Seg
            value={value.format}
            label="Shape"
            onChange={(format) => set({ format, quality: format === "reel" && value.quality === "ultra" ? "high" : value.quality })}
            options={[
              ["reel", "Reel · vertical 9:16"],
              ["youtube", "YouTube · horizontal 16:9"],
            ]}
          />
        </div>
        <div className="field">
          <span>Quality</span>
          <select value={value.quality} onChange={(e) => set({ quality: e.target.value as EditDefaults["quality"] })}>
            {(["standard", "high", "ultra"] as const)
              .filter((q) => yt || q !== "ultra")
              .map((q) => (
                <option key={q} value={q}>
                  {QUALITY_LABEL[q]}
                </option>
              ))}
          </select>
          {!yt ? <small>Instagram plays Reels at 1080p, so High is the best it shows.</small> : null}
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <span>Kind of video</span>
          <select value={value.editType} onChange={(e) => set({ editType: e.target.value as EditType })}>
            {EDIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EDIT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span>Editing standard</span>
          <Seg
            value={value.editStyle}
            label="Editing standard"
            onChange={(editStyle) => set({ editStyle })}
            options={[
              ["professional", "Professional"],
              ["creator", "Creator energetic"],
            ]}
          />
        </div>
      </div>

      {yt ? (
        <label className="check">
          <input type="checkbox" checked={value.fullLength} onChange={(e) => set({ fullLength: e.target.checked })} />
          <span>
            Keep the full message (sermon / full song)
            <br />
            <small className="hint">Everything in order; only dead air, false starts and long pauses are removed.</small>
          </span>
        </label>
      ) : null}
      {!(yt && value.fullLength) ? (
        <label className="field">
          <span>Length: about {fmtLen(seconds)}</span>
          <input
            type="range"
            min={yt ? 30 : 8}
            max={yt ? 3600 : 90}
            step={yt ? 30 : 1}
            value={seconds}
            onChange={(e) => (yt ? set({ youtubeSeconds: Number(e.target.value) }) : set({ defaultSeconds: Number(e.target.value) }))}
          />
        </label>
      ) : null}

      <Group title="Effects (with live samples)" open>
        <EffectsPicker value={value.effects} onChange={(effects) => set({ effects })} />
      </Group>

      <Group title={`Background${value.background.mode !== "none" ? ` · ${value.background.mode === "stock" ? "real photo/video" : value.background.mode}` : ""}`}>
        <BackgroundPicker value={value.background} onChange={(background) => set({ background })} format={value.format} />
      </Group>

      <label className="check">
        <input type="checkbox" checked={value.relight} onChange={(e) => set({ relight: e.target.checked })} />
        <span>
          Studio lighting on the speaker
          <br />
          <small className="hint">Soft key light on the face, a rim light in the backdrop's colour, matched colour, clean and sharp. For talking and sermon videos, and whenever the background is changed.</small>
        </span>
      </label>

      {captionChoice && setCaptionChoice ? (
        <Group title="Text look (fonts, colours, position)">
          <CaptionEditor value={captionChoice} onChange={setCaptionChoice} accent={studio.settings.brand.accentColor} />
        </Group>
      ) : null}

      {branding && setBranding ? (
        <Group title="Watermark and end card">
          <BrandingEditor value={branding} onChange={setBranding} handle={studio.settings.brand.handle} logo={logo} />
        </Group>
      ) : null}

      <Group title="Picture, sound and captions">
        <div className="grid2">
          <div className="field">
            <span>Captions</span>
            <Seg
              value={value.captions ? value.captionLanguage : ("off" as const)}
              label="Captions"
              onChange={(v) => (v === "off" ? set({ captions: false }) : set({ captions: true, captionLanguage: v }))}
              options={[
                ["auto", "Auto"],
                ["en", "English"],
                ["te", "Telugu"],
                ["off", "Off"],
              ]}
            />
          </div>
          <div className="field">
            <span>Framing</span>
            <Seg
              value={value.layout}
              label="Framing"
              onChange={(layout) => set({ layout })}
              options={[
                ["auto", "Auto"],
                ["fill", "Fill"],
                ["blur-pad", "Whole frame"],
              ]}
            />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={value.autoColor} onChange={(e) => set({ autoColor: e.target.checked })} />
          <span>Correct light and colour per clip</span>
        </label>
        <div className="field">
          <span>Steady shaky video</span>
          <Seg
            value={value.stabilize}
            label="Stabilize"
            onChange={(stabilize) => set({ stabilize })}
            options={[
              ["auto", "When needed"],
              ["on", "Always"],
              ["off", "Never"],
            ]}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={value.cleanAudio} onChange={(e) => set({ cleanAudio: e.target.checked })} />
          <span>Clean up the sound (hum, hiss, clearer voices)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={value.keepOriginalAudio} onChange={(e) => set({ keepOriginalAudio: e.target.checked })} />
          <span>Keep the original sound (singing, speech)</span>
        </label>
      </Group>

      <Group title={`Versions and checks${value.extraLengths.length || value.hookOptions > 1 || value.qualityCheck || value.alsoCarousel ? " · on" : ""}`}>
        <div className="field">
          <span>Also make these lengths</span>
          <div className="chips">
            {(yt ? [60, 180, 600] : [15, 30, 45, 60]).map((l) => (
              <button
                key={l}
                type="button"
                className={`chip ${value.extraLengths.includes(l) ? "on" : ""}`}
                onClick={() => set({ extraLengths: value.extraLengths.includes(l) ? value.extraLengths.filter((x) => x !== l) : [...value.extraLengths, l].slice(-3) })}
              >
                {fmtLen(l)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Opening hook options</span>
          <Seg value={String(value.hookOptions) as "1" | "2" | "3"} label="Hook options" onChange={(v) => set({ hookOptions: Number(v) })} options={[["1", "One"], ["2", "Two"], ["3", "Three"]]} />
        </div>
        <label className="check">
          <input type="checkbox" checked={value.qualityCheck} onChange={(e) => set({ qualityCheck: e.target.checked })} />
          <span>
            Double-check the finished video
            <br />
            <small className="hint">Claude watches the result and fixes framing, text and colour problems once. Adds a few minutes.</small>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={value.alsoCarousel} onChange={(e) => set({ alsoCarousel: e.target.checked })} />
          <span>Also make a matching carousel</span>
        </label>
      </Group>
    </div>
  );
}
