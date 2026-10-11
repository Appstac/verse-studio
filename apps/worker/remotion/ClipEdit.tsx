import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Outro, Signature } from "./components/Brand";
import { FONTS, FontGate } from "./fonts";
import { presetStyle } from "./presets";
import { FPS, TRANSITION_FRAMES, type ClipEditProps, type ClipSegment, type Overlay } from "./types";

const segFrames = (s: ClipSegment) => Math.max(1, Math.round(((s.end - s.start) / s.playbackRate) * FPS));

const SegmentView: React.FC<{ seg: ClipSegment; keepAudio: boolean; frames: number }> = ({ seg, keepAudio, frames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const zoom =
    seg.zoom === "punch"
      ? 1.2
      : seg.zoom === "in"
      ? interpolate(frame, [0, frames], [1, 1.12], { extrapolateRight: "clamp" })
      : seg.zoom === "out"
        ? interpolate(frame, [0, frames], [1.12, 1], { extrapolateRight: "clamp" })
        : 1;
  const srcAspect = seg.srcWidth / Math.max(1, seg.srcHeight);
  const outAspect = width / height;
  const pad = seg.layout === "blur-pad" && Math.abs(srcAspect - outAspect) > 0.08;
  const trimBefore = Math.round(seg.start * FPS);
  const common = { src: seg.src, trimBefore, playbackRate: seg.playbackRate } as const;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {pad ? (
        <>
          <AbsoluteFill style={{ transform: "scale(1.25)", filter: "blur(38px) brightness(0.55)" }}>
            <OffthreadVideo {...common} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </AbsoluteFill>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${zoom})` }}>
            <OffthreadVideo
              {...common}
              muted={!keepAudio}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </AbsoluteFill>
        </>
      ) : (
        <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 38%" }}>
          <OffthreadVideo {...common} muted={!keepAudio} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
      )}
      {seg.textOverlay ? <OverlayText text={seg.textOverlay} frames={frames} /> : null}
    </AbsoluteFill>
  );
};

const OverlayText: React.FC<{ text: string; frames: number }> = ({ text, frames }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 8, frames - 8, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const te = /[ఀ-౿]/.test(text);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 300 }}>
      <div
        style={{
          opacity: o,
          maxWidth: 880,
          padding: "18px 34px",
          borderRadius: 22,
          background: "rgba(0,0,0,0.45)",
          color: "#fff",
          fontFamily: te ? FONTS.teluguSans : FONTS.bold,
          fontWeight: 800,
          fontSize: te ? 46 : 54,
          lineHeight: te ? 1.5 : 1.15,
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Hook: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 6, 60, 72], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, [0, 8], [20, 0], { extrapolateRight: "clamp" });
  const te = /[ఀ-౿]/.test(text);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 280 }}>
      <div
        style={{
          opacity: o,
          transform: `translateY(${y}px)`,
          maxWidth: 900,
          padding: "22px 38px",
          borderRadius: 26,
          background: "rgba(255,255,255,0.94)",
          color: "#151515",
          fontFamily: te ? FONTS.teluguSans : FONTS.bold,
          fontWeight: 800,
          fontSize: te ? 50 : 60,
          lineHeight: te ? 1.45 : 1.12,
          textAlign: "center",
          boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Captions: React.FC<{ props: ClipEditProps; accent: string }> = ({ props, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const te = props.captions.language === "telugu";
  const pages = useMemo(() => {
    const caps: Caption[] = props.captions.words.map((w, i) => ({
      text: (i === 0 ? "" : " ") + w.text.trim(),
      startMs: w.startMs,
      endMs: w.endMs,
      timestampMs: (w.startMs + w.endMs) / 2,
      confidence: null,
    }));
    return createTikTokStyleCaptions({ captions: caps, combineTokensWithinMilliseconds: te ? 1400 : 1100 }).pages;
  }, [props.captions.words, te]);
  if (props.captions.style === "none" || pages.length === 0) return null;
  const page = pages.find((p, i) => ms >= p.startMs && ms < (pages[i + 1]?.startMs ?? p.startMs + p.durationMs));
  if (!page || ms > page.startMs + page.durationMs + 400) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 470 }}>
      <div
        style={{
          maxWidth: 940,
          textAlign: "center",
          fontFamily: te ? FONTS.teluguSans : FONTS.bold,
          fontWeight: 800,
          fontSize: te ? 54 : 66,
          lineHeight: te ? 1.5 : 1.15,
          color: "#fff",
          textTransform: te ? undefined : "uppercase",
          WebkitTextStroke: te ? undefined : "2px rgba(0,0,0,0.85)",
          paintOrder: "stroke fill",
          textShadow: "0 4px 18px rgba(0,0,0,0.6)",
        }}
      >
        {page.tokens.map((t, i) => {
          const active = props.captions.style === "karaoke" && ms >= t.fromMs && ms < t.toMs;
          return (
            <span
              key={i}
              style={{
                whiteSpace: "pre",
                color: active ? accent : "#fff",
                display: "inline-block",
                transform: active ? "scale(1.08)" : undefined,
              }}
            >
              {t.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

// Big 1-3 word captions in the centre, with key words in a gold script font.
const PopCaptions: React.FC<{ props: ClipEditProps; accent: string }> = ({ props, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const te = props.captions.language === "telugu";
  const emph = useMemo(() => new Set((props.captions.emphasis ?? []).map(norm)), [props.captions.emphasis]);
  const pages = useMemo(() => {
    const caps: Caption[] = props.captions.words.map((w, i) => ({
      text: (i === 0 ? "" : " ") + w.text.trim(),
      startMs: w.startMs,
      endMs: w.endMs,
      timestampMs: (w.startMs + w.endMs) / 2,
      confidence: null,
    }));
    return createTikTokStyleCaptions({ captions: caps, combineTokensWithinMilliseconds: te ? 650 : 420 }).pages;
  }, [props.captions.words, te]);
  const idx = pages.findIndex((p, i) => ms >= p.startMs && ms < (pages[i + 1]?.startMs ?? p.startMs + p.durationMs + 300));
  if (idx < 0) return null;
  const page = pages[idx];
  if (ms > page.startMs + page.durationMs + 300) return null;
  const local = frame - Math.round((page.startMs / 1000) * fps);
  const pop = spring({ frame: local, fps, config: { damping: 13, mass: 0.5, stiffness: 180 } });
  const words = page.tokens.map((t) => t.text.trim()).filter(Boolean);
  const long = words.join(" ").length > 14;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingTop: 520 }}>
      <div
        style={{
          maxWidth: 960,
          textAlign: "center",
          lineHeight: te ? 1.35 : 0.98,
          transform: `scale(${0.82 + 0.18 * pop})`,
          opacity: Math.min(1, pop * 1.4),
          textShadow: "0 6px 28px rgba(0,0,0,0.55)",
        }}
      >
        {words.map((w, i) => {
          const isEmph = emph.has(norm(w));
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                margin: "0 0.12em",
                color: isEmph ? accent : "#fff",
                fontFamily: isEmph && !te ? FONTS.display : te ? FONTS.teluguSans : FONTS.sans,
                fontStyle: isEmph && !te ? "italic" : "normal",
                fontWeight: isEmph ? 500 : 700,
                fontSize: (te ? 80 : long ? 104 : 128) * (isEmph ? 1.08 : 1),
                letterSpacing: isEmph ? 0 : -3,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const OverlayCard: React.FC<{ o: Overlay; frames: number; tilt: number }> = ({ o, frames, tilt }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const inS = spring({ frame, fps, config: { damping: 12, mass: 0.6 } });
  const out = interpolate(frame, [frames - 8, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const s = inS * out;
  const w = o.position === "corner" ? width * 0.42 : width * 0.66;
  const h = Math.min(w / Math.max(0.4, o.aspect), o.position === "center" ? 1100 : 700);
  const pos: React.CSSProperties =
    o.position === "corner" ? { top: 230, right: 70 } : o.position === "top" ? { top: 210, left: (width - w) / 2 } : { top: 520, left: (width - w) / 2 };
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          ...pos,
          width: w,
          height: h,
          borderRadius: 28,
          overflow: "hidden",
          border: "8px solid #fff",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          transform: `scale(${0.6 + 0.4 * s}) rotate(${tilt * s}deg)`,
          opacity: s,
          background: "#111",
        }}
      >
        {o.type === "image" ? (
          <Img src={o.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <OffthreadVideo src={o.src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
    </AbsoluteFill>
  );
};

export const ClipEdit: React.FC<ClipEditProps> = (props) => {
  const st = presetStyle(props.preset, props.captions.language, props.brand.accent);
  const segs = props.segments;
  const body = segs.reduce((a, s) => a + segFrames(s), 0) - (props.transition === "fade" && segs.length > 1 ? TRANSITION_FRAMES * (segs.length - 1) : 0);
  const outroFrames = props.brand.outro.enabled ? Math.round(props.brand.outro.seconds * FPS) : 0;
  // Frames where one segment hands over to the next (for whoosh sounds).
  const cutFrames: number[] = [];
  {
    let acc = 0;
    segs.forEach((sg, i) => {
      acc += segFrames(sg) - (props.transition === "fade" && i < segs.length - 1 ? TRANSITION_FRAMES : 0);
      if (i < segs.length - 1 && segs[i + 1].src !== sg.src) cutFrames.push(acc);
    });
  }
  return (
    <FontGate>
      <AbsoluteFill style={{ background: "#000" }}>
        <Sequence durationInFrames={body}>
          <TransitionSeries>
            {segs.flatMap((s, i) => {
              const f = segFrames(s);
              const items = [
                <TransitionSeries.Sequence key={`s${i}`} durationInFrames={f}>
                  <SegmentView seg={s} keepAudio={props.keepAudio} frames={f} />
                </TransitionSeries.Sequence>,
              ];
              if (props.transition === "fade" && i < segs.length - 1) {
                items.push(
                  <TransitionSeries.Transition
                    key={`t${i}`}
                    presentation={fade()}
                    timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
                  />,
                );
              }
              return items;
            })}
          </TransitionSeries>
          {props.captions.style === "pop" ? <PopCaptions props={props} accent={props.brand.accent} /> : <Captions props={props} accent={props.brand.accent} />}
          {(props.overlays ?? []).map((o, i) => {
            const from = Math.round(o.at * FPS);
            const dur = Math.max(FPS, Math.round(o.duration * FPS));
            return (
              <Sequence key={`ov${i}`} from={from} durationInFrames={dur}>
                <OverlayCard o={o} frames={dur} tilt={i % 2 ? 2.5 : -2.5} />
                {props.sfx?.pop ? <Audio src={props.sfx.pop} volume={0.55} /> : null}
              </Sequence>
            );
          })}
          {props.sfx?.whoosh
            ? cutFrames.map((f, i) => (
                <Sequence key={`wh${i}`} from={Math.max(0, f - 4)} durationInFrames={20}>
                  <Audio src={props.sfx!.whoosh!} volume={0.32} />
                </Sequence>
              ))
            : null}
          {props.hook ? <Hook text={props.hook} /> : null}
          <Signature brand={props.brand} color="#ffffff" />
        </Sequence>
        {outroFrames > 0 ? (
          <Sequence from={body} durationInFrames={outroFrames}>
            <Background preset={props.preset === "photo" ? "night" : props.preset} seed={7} />
            <Outro
              brand={props.cta ? { ...props.brand, outro: { ...props.brand.outro, text: props.cta } } : props.brand}
              startFrame={0}
              color={st.text}
              muted={st.muted}
              accent={st.accent}
            />
          </Sequence>
        ) : null}
      </AbsoluteFill>
    </FontGate>
  );
};
