// Worship-night design language (modelled on how worship collectives post):
//  - LyricWindow: a retro pop-up dialog box; each sung line types into it.
//  - TypedLines: serif story lines typed with a blinking cursor (promos, recaps).
//  - PosterCard: white card, colour band, big serif title, event header and date.
//  - RecapOpener: black screen, big serif word + script word, clip tiles popping in.
import React from "react";
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONTS } from "../fonts";

const isTelugu = (t: string) => /[ఀ-౿]/.test(t);
export type TimedLine = { text: string; startMs: number; endMs: number };

/** How many characters of a line are visible: types out over the first part of the line. */
function typed(text: string, localMs: number, durMs: number) {
  const typeMs = Math.min(durMs * 0.55, Math.max(500, text.length * 55));
  return Math.max(0, Math.min(text.length, Math.round((localMs / typeMs) * text.length)));
}

const Cursor: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  return <span style={{ color, opacity: Math.floor(frame / 15) % 2 ? 0 : 1, fontWeight: 400 }}>|</span>;
};

export const LyricWindow: React.FC<{ lines: TimedLine[]; color: string; land: boolean }> = ({ lines, color, land }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const firstStart = lines[0]?.startMs ?? 0;
  const lastEnd = lines[lines.length - 1]?.endMs ?? 0;
  if (!lines.length || ms < firstStart - 400 || ms > lastEnd + 600) return null;
  const line = lines.find((l) => ms >= l.startMs && ms < l.endMs + 250) ?? null;
  // The window pops in once, then stays while the song plays.
  const appear = spring({ frame: frame - Math.round(((firstStart - 400) / 1000) * fps), fps, config: { damping: 14, mass: 0.6 } });
  const leave = interpolate(ms, [lastEnd + 200, lastEnd + 600], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const w = land ? 860 : Math.min(860, width * 0.8);
  const te = line ? isTelugu(line.text) : false;
  const shown = line ? line.text.slice(0, typed(line.text, ms - line.startMs, line.endMs - line.startMs)) : "";
  const done = line ? shown.length >= line.text.length : true;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: land ? 70 : 300 }}>
      <div
        style={{
          width: w,
          transform: `scale(${0.85 + 0.15 * appear})`,
          opacity: Math.min(1, appear * 1.4) * leave,
          borderRadius: 14,
          overflow: "hidden",
          background: "#fff",
          border: `3px solid ${color}`,
          boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ height: 40, background: `linear-gradient(180deg, ${color}, ${color}dd)`, display: "flex", alignItems: "center", padding: "0 12px" }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: "#fff", color, fontFamily: FONTS.bold, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>×</div>
        </div>
        <div
          style={{
            minHeight: 150,
            padding: "24px 32px 12px",
            textAlign: "center",
            color,
            fontFamily: te ? FONTS.teluguSans : FONTS.type,
            fontWeight: 700,
            fontSize: te ? 40 : 48,
            lineHeight: te ? 1.5 : 1.25,
            whiteSpace: "pre-wrap",
          }}
        >
          {shown}
          {!done ? <Cursor color={color} /> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 16 }}>
          <div style={{ width: 64, height: 26, borderRadius: 6, border: `2.5px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", color, fontSize: 16 }}>♥</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const TypedLines: React.FC<{ lines: TimedLine[]; land: boolean; position: "upper" | "middle" | "lower"; color?: string }> = ({ lines, land, position, color = "#fff" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const line = lines.find((l) => ms >= l.startMs && ms < l.endMs + 200);
  if (!line) return null;
  const local = ms - line.startMs;
  const dur = line.endMs - line.startMs;
  const n = typed(line.text, local, dur);
  const fade = interpolate(local, [dur - 150, dur + 200], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const te = isTelugu(line.text);
  const place: React.CSSProperties =
    position === "upper"
      ? { justifyContent: "flex-start", paddingTop: land ? 110 : 380 }
      : position === "middle"
        ? { justifyContent: "center" }
        : { justifyContent: "flex-end", paddingBottom: land ? 120 : 520 };
  return (
    <AbsoluteFill style={{ alignItems: "center", ...place }}>
      <div
        style={{
          maxWidth: land ? 1400 : 900,
          textAlign: "center",
          color,
          opacity: fade,
          fontFamily: te ? FONTS.teluguSerif : FONTS.display,
          fontWeight: 500,
          fontSize: te ? 50 : land ? 56 : 60,
          lineHeight: te ? 1.5 : 1.22,
          textShadow: "0 2px 14px rgba(0,0,0,0.65)",
          whiteSpace: "pre-wrap",
        }}
      >
        {line.text.slice(0, n)}
        {n < line.text.length || Math.floor(frame / 15) % 2 === 0 ? <span style={{ fontWeight: 300 }}>|</span> : null}
      </div>
    </AbsoluteFill>
  );
};

const Flower: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="-50 -50 100 100">
    {[0, 72, 144, 216, 288].map((a) => (
      <ellipse key={a} cx={0} cy={-24} rx={17} ry={26} fill={color} opacity={0.9} transform={`rotate(${a})`} />
    ))}
    <circle r={11} fill="#ffd36b" />
  </svg>
);

export const PosterCard: React.FC<{ title: string; header?: string; date?: string; color: string; frames: number; land: boolean }> = ({ title, header, date, color, frames, land }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 13, mass: 0.7 } });
  const out = interpolate(frame, [frames - 10, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const w = land ? 760 : Math.min(840, width * 0.82);
  const te = isTelugu(title);
  const big = Math.max(56, Math.min(96, 980 / Math.max(6, title.length) * 1.4));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: land ? 0 : 260 }}>
      <div style={{ position: "relative", transform: `scale(${0.8 + 0.2 * pop}) rotate(${(1 - pop) * -4}deg)`, opacity: Math.min(1, pop * 1.5) * out }}>
        <div style={{ position: "absolute", left: -34, top: -34, zIndex: 2, transform: `rotate(${frame * 0.6}deg)` }}>
          <Flower size={96} color="#f6b3d0" />
        </div>
        <div style={{ width: w, background: "#fff", borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.45)", padding: "26px 0 22px", textAlign: "center" }}>
          {header ? <div style={{ fontFamily: FONTS.display, fontSize: 30, color: "#222", marginBottom: 18 }}>{header}</div> : null}
          <div style={{ background: `linear-gradient(90deg, ${color}99, ${color}, ${color}99)`, padding: "30px 30px", margin: "0 26px" }}>
            <div
              style={{
                fontFamily: te ? FONTS.teluguSerif : FONTS.display,
                fontWeight: 800,
                fontSize: te ? big * 0.7 : big,
                lineHeight: 1.0,
                color: "#1a1a1a",
                textTransform: te ? undefined : "uppercase",
                letterSpacing: te ? 0 : -1,
              }}
            >
              {title}
            </div>
          </div>
          {date ? (
            <div style={{ fontFamily: FONTS.display, fontSize: 26, color: "#222", marginTop: 18, display: "flex", justifyContent: "center", gap: 70 }}>
              {date.split(" ").map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const RecapOpener: React.FC<{ word: string; script: string; tiles: Array<{ src: string; trimBefore: number }>; frames: number; land: boolean }> = ({ word, script, tiles, frames, land }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const out = interpolate(frame, [frames - 8, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const t = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  // Tiles fill a 3x4 (vertical) or 4x3 (horizontal) grid one by one, like a contact sheet.
  const cols = land ? 4 : 3;
  const rows = land ? 3 : 4;
  const cw = width / cols;
  const ch = height / rows;
  const order = [1, 6, 3, 8, 0, 10, 5, 2, 11, 7, 4, 9];
  return (
    <AbsoluteFill style={{ background: "#000", opacity: out }}>
      {order.slice(0, Math.min(order.length, tiles.length * 3)).map((cell, k) => {
        const start = 12 + k * 4;
        if (frame < start) return null;
        const s = spring({ frame: frame - start, fps, config: { damping: 16, mass: 0.5 } });
        const tile = tiles[k % tiles.length];
        return (
          <div key={cell} style={{ position: "absolute", left: (cell % cols) * cw, top: Math.floor(cell / cols) * ch, width: cw, height: ch, overflow: "hidden", transform: `scale(${0.6 + 0.4 * s})`, opacity: s }}>
            <OffthreadVideo src={tile.src} trimBefore={tile.trimBefore} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        );
      })}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", transform: `translateY(${(1 - t) * 20}px)`, opacity: t, textShadow: "0 4px 24px rgba(0,0,0,0.8)" }}>
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: land ? 120 : 140, color: "#fff", letterSpacing: 2, lineHeight: 1 }}>{word.toUpperCase()}</div>
          <div style={{ fontFamily: FONTS.hand, fontSize: land ? 110 : 130, color: "#fff", marginTop: -36, lineHeight: 1 }}>{script}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
