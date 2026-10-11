import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Outro, Signature } from "./components/Brand";
import { FONTS, FontGate } from "./fonts";
import { presetStyle } from "./presets";
import { FPS, TRANSITION_FRAMES, type ClipEditProps, type ClipSegment } from "./types";

const segFrames = (s: ClipSegment) => Math.max(1, Math.round(((s.end - s.start) / s.playbackRate) * FPS));

const SegmentView: React.FC<{ seg: ClipSegment; keepAudio: boolean; frames: number }> = ({ seg, keepAudio, frames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const zoom =
    seg.zoom === "in"
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
        <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
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

export const ClipEdit: React.FC<ClipEditProps> = (props) => {
  const st = presetStyle(props.preset, props.captions.language, props.brand.accent);
  const segs = props.segments;
  const body = segs.reduce((a, s) => a + segFrames(s), 0) - (props.transition === "fade" && segs.length > 1 ? TRANSITION_FRAMES * (segs.length - 1) : 0);
  const outroFrames = props.brand.outro.enabled ? Math.round(props.brand.outro.seconds * FPS) : 0;
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
          <Captions props={props} accent={props.brand.accent} />
          {props.hook ? <Hook text={props.hook} /> : null}
          <Signature brand={props.brand} color="#ffffff" />
        </Sequence>
        {outroFrames > 0 ? (
          <Sequence from={body} durationInFrames={outroFrames}>
            <Background preset={props.preset === "photo" ? "night" : props.preset} seed={7} />
            <Outro brand={props.brand} startFrame={0} color={st.text} muted={st.muted} accent={st.accent} />
          </Sequence>
        ) : null}
      </AbsoluteFill>
    </FontGate>
  );
};
