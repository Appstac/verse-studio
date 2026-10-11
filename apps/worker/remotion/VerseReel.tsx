import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Outro, Signature } from "./components/Brand";
import { FONTS, FontGate } from "./fonts";
import { presetStyle } from "./presets";
import type { VerseReelProps } from "./types";

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

export function verseFontSize(text: string, lang: string, minimal: boolean): number {
  const len = text.length;
  let size = Math.max(56, Math.min(104, 136 - len * 0.45));
  if (minimal) size *= 0.8;
  if (lang === "telugu") size *= 0.78;
  return Math.round(size);
}

const Hook: React.FC<{ text: string; frames: number; font: string; weight: number; upper: boolean; color: string; shadow: string; telugu: boolean }> = ({
  text,
  frames,
  font,
  weight,
  upper,
  color,
  shadow,
  telugu,
}) => {
  const frame = useCurrentFrame();
  if (frame > frames + 10) return null;
  const inO = interpolate(frame, [0, 7], [0, 1], { extrapolateRight: "clamp" });
  const outO = interpolate(frame, [frames - 6, frames + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = interpolate(frame, [0, frames], [0.97, 1.02]);
  const blur = interpolate(frame, [frames - 6, frames + 6], [0, 10], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = Math.max(58, Math.min(92, 112 - text.length * 0.9)) * (telugu ? 0.82 : 1);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "260px 100px 460px" }}>
      <div
        style={{
          fontFamily: font,
          fontWeight: weight,
          fontSize: size,
          lineHeight: telugu ? 1.5 : 1.18,
          color,
          textAlign: "center",
          textTransform: upper ? "uppercase" : undefined,
          letterSpacing: upper ? 1 : 0,
          textShadow: shadow,
          opacity: inO * outO,
          transform: `scale(${scale})`,
          filter: `blur(${blur}px)`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const VerseReel: React.FC<VerseReelProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const te = props.language === "telugu";
  const st = presetStyle(props.preset, props.language, props.brand.accent);
  const minimal = props.preset === "minimal";

  const hookFrames = props.hook ? Math.round(props.hookSeconds * fps) : 0;
  const verseStart = Math.max(0, hookFrames - 4);
  const verseFrames = Math.round(props.verseSeconds * fps);
  const outroStart = verseStart + verseFrames;

  const words = useMemo(() => props.verseText.split(/\s+/).filter(Boolean), [props.verseText]);
  const emph = useMemo(() => new Set((props.emphasis ?? []).map(norm)), [props.emphasis]);
  const revealWindow = Math.min(verseFrames * 0.55, words.length * (minimal ? 7 : 6));
  const stagger = words.length > 0 ? revealWindow / words.length : 0;
  const size = verseFontSize(props.verseText, props.language, minimal);

  const local = frame - verseStart;
  const refO = interpolate(local, [revealWindow + 4, revealWindow + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const outroFade = props.brand.outro.enabled
    ? interpolate(frame, [outroStart - 4, outroStart + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  const push = interpolate(frame, [verseStart, durationInFrames], [1, 1.035], { extrapolateLeft: "clamp" });

  return (
    <FontGate>
      <AbsoluteFill style={{ background: "#000" }}>
        <Background preset={props.preset} seed={props.seed} media={props.background} />

        {props.hook ? (
          <Hook
            text={props.hook}
            frames={hookFrames}
            font={st.hookFont}
            weight={st.hookWeight}
            upper={st.upper}
            color={st.text}
            shadow={st.shadow}
            telugu={te}
          />
        ) : null}

        {local >= 0 ? (
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              padding: "250px 96px 470px",
              opacity: outroFade,
              transform: `scale(${push})`,
            }}
          >
            <div
              style={{
                fontFamily: st.verseFont,
                fontStyle: st.verseItalic ? "italic" : "normal",
                fontWeight: st.verseWeight,
                fontSize: size,
                lineHeight: te ? 1.55 : minimal ? 1.12 : 1.22,
                color: st.text,
                textAlign: "center",
                textShadow: st.shadow,
                textTransform: st.upper ? "uppercase" : undefined,
              }}
            >
              {words.map((w, i) => {
                const start = i * stagger;
                const f = local - start;
                let o: number;
                let y: number;
                let blur: number;
                let sc = 1;
                if (minimal) {
                  const s = spring({ frame: f, fps, config: { damping: 14, mass: 0.6 } });
                  o = interpolate(f, [0, 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                  sc = 0.7 + 0.3 * s;
                  y = 0;
                  blur = 0;
                } else {
                  o = interpolate(f, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                  y = interpolate(f, [0, 14], [22, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                  blur = interpolate(f, [0, 12], [8, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                }
                const isEmph = emph.has(norm(w));
                return (
                  <span
                    key={i}
                    style={{
                      display: "inline-block",
                      marginRight: "0.26em",
                      opacity: o,
                      transform: `translateY(${y}px) scale(${sc})`,
                      filter: blur ? `blur(${blur}px)` : undefined,
                      color: isEmph ? st.accent : undefined,
                      fontStyle: isEmph && !minimal && !te ? "italic" : undefined,
                    }}
                  >
                    {w}
                  </span>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 48,
                display: "flex",
                alignItems: "center",
                gap: 22,
                opacity: refO,
                color: st.accent,
                fontFamily: FONTS.sans,
                fontWeight: 600,
                fontSize: 34,
                letterSpacing: 5,
                textTransform: "uppercase",
              }}
            >
              <span style={{ width: 56, height: 2, background: st.accent, opacity: 0.8 }} />
              <span>{props.reference}</span>
              <span style={{ width: 56, height: 2, background: st.accent, opacity: 0.8 }} />
            </div>
          </AbsoluteFill>
        ) : null}

        <Outro brand={props.brand} startFrame={outroStart} color={st.text} muted={st.muted} accent={st.accent} />
        <Signature brand={props.brand} color={st.text} hideAfterFrame={props.brand.outro.enabled ? outroStart - 4 : undefined} />
      </AbsoluteFill>
    </FontGate>
  );
};
