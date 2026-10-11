// Watermark + end card editor and on-video text style editor, with small live previews.
// Used in Settings (defaults), on Make → Edit (per video) and on a finished video's change panel.
import React from "react";
import * as g from "../google";
import {
  CAPTION_PRESETS,
  CAPTION_STYLES,
  TEXT_FONTS,
  WATERMARK_PRESETS,
  type Branding,
  type CaptionChoice,
  type CaptionLook,
  type TextFont,
} from "@shared/schema";

export const FONT_LABEL: Record<TextFont, string> = {
  clean: "Clean",
  bold: "Bold",
  elegant: "Elegant serif",
  classic: "Classic serif",
  handwritten: "Handwritten",
};

export const FONT_CSS: Record<TextFont, string> = {
  clean: "Inter, 'Noto Sans Telugu', system-ui, sans-serif",
  bold: "Montserrat, 'Noto Sans Telugu', sans-serif",
  elegant: "'Playfair Display', 'Noto Sans Telugu', Georgia, serif",
  classic: "'Cormorant Garamond', 'Noto Sans Telugu', Georgia, serif",
  handwritten: "Caveat, 'Noto Sans Telugu', cursive",
};

const POSITIONS: Array<[Branding["watermark"]["position"], string]> = [
  ["top-left", "Top left"],
  ["top-center", "Top centre"],
  ["top-right", "Top right"],
  ["bottom-left", "Bottom left"],
  ["bottom-center", "Bottom centre"],
  ["bottom-right", "Bottom right"],
];

const STYLE_LABEL: Record<Branding["watermark"]["style"], string> = { plain: "Plain", shadow: "Soft shadow", pill: "Dark pill", outline: "Outline" };
const CAPTION_STYLE_LABEL: Record<(typeof CAPTION_STYLES)[number], string> = {
  pop: "Big pop-up words",
  karaoke: "Karaoke highlight",
  lines: "Full lines",
  lyrics: "Worship lyrics",
  none: "No captions",
};

// The preview frame is 9:16 at this width; sizes scale from the real 1080px frame.
const PW = 150;
const k = PW / 1080;

function WatermarkMark({ wm, logo }: { wm: Branding["watermark"]; logo?: string }) {
  const size = Math.max(7, wm.size * k);
  const pos: React.CSSProperties = { position: "absolute", display: "flex", alignItems: "center", gap: size / 2, opacity: wm.opacity };
  if (wm.position.startsWith("bottom")) pos.bottom = 360 * k;
  else pos.top = 170 * k;
  if (wm.position.endsWith("left")) pos.left = 84 * k;
  else if (wm.position.endsWith("right")) pos.right = 170 * k;
  else {
    pos.left = 0;
    pos.right = 0;
    pos.justifyContent = "center";
  }
  return (
    <div style={pos}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: size / 2,
          ...(wm.style === "pill" ? { background: "rgba(0,0,0,0.45)", padding: `${size * 0.3}px ${size * 0.7}px`, borderRadius: 999 } : {}),
        }}
      >
        {wm.showLogo && logo ? <img src={logo} alt="" style={{ width: size * 1.8, height: size * 1.8, borderRadius: "50%", objectFit: "cover" }} /> : null}
        <span
          style={{
            fontFamily: FONT_CSS[wm.font],
            fontWeight: wm.font === "bold" ? 800 : 600,
            fontSize: size,
            color: wm.color,
            whiteSpace: "nowrap",
            textShadow: wm.style === "shadow" ? "0 1px 4px rgba(0,0,0,0.6)" : undefined,
            WebkitTextStroke: wm.style === "outline" ? "0.6px rgba(0,0,0,0.85)" : undefined,
          }}
        >
          {wm.text}
        </span>
      </div>
    </div>
  );
}

function Phone({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <figure className="phone-preview">
      <div className="phone" style={{ width: PW, height: (PW * 16) / 9 }}>
        {children}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function BrandingEditor({ value, onChange, logo, handle }: { value: Branding; onChange: (b: Branding) => void; logo?: string; handle: string }) {
  const wm = value.watermark;
  const ec = value.endCard;
  const setWm = (p: Partial<Branding["watermark"]>) => onChange({ ...value, watermark: { ...wm, ...p } });
  const setEc = (p: Partial<Branding["endCard"]>) => onChange({ ...value, endCard: { ...ec, ...p } });
  return (
    <div className="stack">
      <div className="editor-with-preview">
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={wm.enabled} onChange={(e) => setWm({ enabled: e.target.checked })} />
            <span style={{ fontWeight: 600 }}>Show watermark</span>
          </label>
          {wm.enabled ? (
            <>
              <div className="field">
                <span>Presets</span>
                <div className="chips">
                  {WATERMARK_PRESETS.map((p) => (
                    <button key={p.id} type="button" className="chip" onClick={() => setWm(p.patch)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Watermark text</span>
                <input type="text" value={wm.text} onChange={(e) => setWm({ text: e.target.value })} placeholder={handle} />
              </label>
              <div className="grid2">
                <label className="field">
                  <span>Font</span>
                  <select value={wm.font} onChange={(e) => setWm({ font: e.target.value as TextFont })}>
                    {TEXT_FONTS.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: FONT_CSS[f] }}>
                        {FONT_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Position</span>
                  <select value={wm.position} onChange={(e) => setWm({ position: e.target.value as Branding["watermark"]["position"] })}>
                    {POSITIONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid2">
                <label className="field">
                  <span>Size: {wm.size}</span>
                  <input type="range" min={16} max={96} step={2} value={wm.size} onChange={(e) => setWm({ size: Number(e.target.value) })} />
                </label>
                <label className="field">
                  <span>Visibility: {Math.round(wm.opacity * 100)}%</span>
                  <input type="range" min={0.2} max={1} step={0.05} value={wm.opacity} onChange={(e) => setWm({ opacity: Number(e.target.value) })} />
                </label>
              </div>
              <div className="grid2">
                <label className="field">
                  <span>Style</span>
                  <select value={wm.style} onChange={(e) => setWm({ style: e.target.value as Branding["watermark"]["style"] })}>
                    {Object.entries(STYLE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Colour</span>
                  <input type="color" value={wm.color} onChange={(e) => setWm({ color: e.target.value })} className="swatch-input" />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={wm.showLogo} onChange={(e) => setWm({ showLogo: e.target.checked })} disabled={!logo} />
                <span>Show logo next to it{logo ? "" : " (upload a logo in Settings first)"}</span>
              </label>
            </>
          ) : null}
        </div>
        <Phone label="Watermark">
          <div className="phone-bg" />
          {wm.enabled ? <WatermarkMark wm={wm} logo={logo} /> : null}
        </Phone>
      </div>

      <div className="editor-with-preview">
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={ec.enabled} onChange={(e) => setEc({ enabled: e.target.checked })} />
            <span style={{ fontWeight: 600 }}>End with a closing card</span>
          </label>
          {ec.enabled ? (
            <>
              <label className="field">
                <span>Big line</span>
                <input type="text" value={ec.title} onChange={(e) => setEc({ title: e.target.value })} placeholder={handle} />
              </label>
              <label className="field">
                <span>Closing script (one line per row)</span>
                <textarea value={ec.text} onChange={(e) => setEc({ text: e.target.value })} rows={3} disabled={ec.claudeWrites} />
              </label>
              <label className="check">
                <input type="checkbox" checked={ec.claudeWrites} onChange={(e) => setEc({ claudeWrites: e.target.checked })} />
                <span>
                  Let Claude write a closing line that fits each video
                  <br />
                  <small className="hint">Off: your script above is used exactly as written.</small>
                </span>
              </label>
              <div className="grid2">
                <label className="field">
                  <span>Length: {ec.seconds}s</span>
                  <input type="range" min={1} max={6} step={0.5} value={ec.seconds} onChange={(e) => setEc({ seconds: Number(e.target.value) })} />
                </label>
                <label className="check" style={{ alignSelf: "end" }}>
                  <input type="checkbox" checked={ec.showLogo} onChange={(e) => setEc({ showLogo: e.target.checked })} disabled={!logo} />
                  <span>Show logo</span>
                </label>
              </div>
            </>
          ) : null}
        </div>
        <Phone label="End card">
          <div className="phone-bg night" />
          {ec.enabled ? (
            <div className="endcard-preview">
              {ec.showLogo && logo ? <img src={logo} alt="" /> : null}
              <b>{ec.title || handle}</b>
              <i />
              {(ec.claudeWrites ? "(Claude writes this line)" : ec.text).split(/\n+/).map((t, i) => (
                <span key={i}>{t}</span>
              ))}
            </div>
          ) : null}
        </Phone>
      </div>
    </div>
  );
}

export function CaptionEditor({ value, onChange, accent }: { value: CaptionChoice; onChange: (c: CaptionChoice) => void; accent: string }) {
  const look = value.look;
  const setLook = (p: Partial<CaptionLook>) => onChange({ ...value, look: { ...look, ...p } });
  const size = { small: 0.8, medium: 1, large: 1.2 }[look.size] * (look.font === "handwritten" ? 16 : 13);
  const pos: React.CSSProperties =
    look.position === "upper" ? { top: 400 * k } : look.position === "lower" ? { bottom: 470 * k } : { top: "50%", transform: "translateY(-30%)" };
  return (
    <div className="editor-with-preview">
      <div className="stack">
        <div className="field">
          <span>Presets</span>
          <div className="chips">
            {CAPTION_PRESETS.map((p) => (
              <button key={p.id} type="button" className="chip" onClick={() => onChange({ style: p.style, look: { ...look, ...p.look } })}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid2">
          <label className="field">
            <span>Caption style</span>
            <select value={value.style} onChange={(e) => onChange({ ...value, style: e.target.value as CaptionChoice["style"] })}>
              {CAPTION_STYLES.map((s) => (
                <option key={s} value={s}>
                  {CAPTION_STYLE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Font</span>
            <select value={look.font} onChange={(e) => setLook({ font: e.target.value as TextFont })}>
              {TEXT_FONTS.map((f) => (
                <option key={f} value={f}>
                  {FONT_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid3">
          <label className="field">
            <span>Size</span>
            <select value={look.size} onChange={(e) => setLook({ size: e.target.value as CaptionLook["size"] })}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label className="field">
            <span>Position</span>
            <select value={look.position} onChange={(e) => setLook({ position: e.target.value as CaptionLook["position"] })}>
              <option value="upper">Upper</option>
              <option value="middle">Middle</option>
              <option value="lower">Lower</option>
            </select>
          </label>
          <label className="field">
            <span>Background</span>
            <select value={look.background} onChange={(e) => setLook({ background: e.target.value as CaptionLook["background"] })}>
              <option value="none">None</option>
              <option value="shadow">Shadow</option>
              <option value="box">Dark box</option>
            </select>
          </label>
        </div>
        <div className="grid3">
          <label className="field">
            <span>Text colour</span>
            <input type="color" value={look.color} onChange={(e) => setLook({ color: e.target.value })} className="swatch-input" />
          </label>
          <label className="field">
            <span>Key words</span>
            <input type="color" value={look.highlight || accent} onChange={(e) => setLook({ highlight: e.target.value })} className="swatch-input" />
          </label>
          <label className="check" style={{ alignSelf: "end" }}>
            <input type="checkbox" checked={look.uppercase} onChange={(e) => setLook({ uppercase: e.target.checked })} />
            <span>CAPITALS</span>
          </label>
        </div>
      </div>
      <Phone label="Captions">
        <div className="phone-bg" />
        {value.style !== "none" ? (
          <div style={{ position: "absolute", left: 8, right: 8, textAlign: "center", ...pos }}>
            <span
              style={{
                fontFamily: FONT_CSS[look.font],
                fontWeight: look.font === "bold" ? 800 : 600,
                fontStyle: value.style === "lyrics" && look.font === "elegant" ? "italic" : undefined,
                fontSize: size,
                lineHeight: 1.2,
                color: look.color,
                textTransform: look.uppercase ? "uppercase" : undefined,
                textShadow: look.background === "none" ? undefined : "0 1px 5px rgba(0,0,0,0.7)",
                ...(look.background === "box" ? { background: "rgba(0,0,0,0.55)", padding: "2px 6px", borderRadius: 4 } : {}),
              }}
            >
              {value.style === "lyrics" ? "You are worthy of all praise" : value.style === "pop" ? "He is " : "He is with you "}
              <span style={{ color: look.highlight || accent }}>{value.style === "lyrics" ? "" : "faithful"}</span>
            </span>
          </div>
        ) : null}
      </Phone>
    </div>
  );
}

/** Object URL of the logo in Drive, for previews. */
export function useLogoUrl(fileId?: string) {
  const [url, setUrl] = React.useState<string>();
  React.useEffect(() => {
    let live = true;
    if (fileId)
      g.objectUrl(fileId)
        .then((u) => live && setUrl(u))
        .catch(() => live && setUrl(undefined));
    else setUrl(undefined);
    return () => {
      live = false;
    };
  }, [fileId]);
  return url;
}
