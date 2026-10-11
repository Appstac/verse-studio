import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Outro, Signature, fontFor } from "./components/Brand";
import { FONTS, FontGate } from "./fonts";
import { presetStyle } from "./presets";
import { FPS, TRANSITION_FRAMES, type CaptionLookProps, type ClipEditProps, type ClipSegment, type Grade, type Overlay } from "./types";

const segFrames = (s: ClipSegment) => Math.max(1, Math.round(((s.end - s.start) / s.playbackRate) * FPS));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const isTelugu = (t: string) => /[ఀ-౿]/.test(t);

const DEFAULT_LOOK: CaptionLookProps = { font: "bold", color: "#ffffff", highlight: "", size: "medium", position: "middle", background: "shadow", uppercase: false };
const SIZE = { small: 0.8, medium: 1, large: 1.2 } as const;

// ---------------------------------------------------------------------------
// Colour correction: an SVG filter per grade, applied to the video with CSS.

function curve(g: Grade, channel: "r" | "g" | "b"): string {
  const pts: string[] = [];
  const gain = 2 ** (clamp(g.exposure, -1, 1) * 0.6);
  const knee = 0.68;
  const squash = 1 - 0.6 * clamp(g.highlights, 0, 1);
  const k = 1 + clamp(g.contrast, -1, 1) * 0.35;
  const w = clamp(g.warmth, -1, 1);
  const tint = channel === "r" ? 1 + w * 0.07 : channel === "b" ? 1 - w * 0.08 : 1 + w * 0.015;
  for (let i = 0; i <= 16; i++) {
    let v = (i / 16) * gain;
    if (v > knee) v = knee + (v - knee) * squash;
    v = 0.5 + (v - 0.5) * k;
    v *= tint;
    pts.push(clamp(v, 0, 1).toFixed(4));
  }
  return pts.join(" ");
}

const GradeDefs: React.FC<{ grades: Grade[] }> = ({ grades }) => (
  <svg width="0" height="0" style={{ position: "absolute" }}>
    <defs>
      {grades.map((g, i) => (
        <filter key={i} id={`grade${i}`} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={curve(g, "r")} />
            <feFuncG type="table" tableValues={curve(g, "g")} />
            <feFuncB type="table" tableValues={curve(g, "b")} />
          </feComponentTransfer>
          <feColorMatrix type="saturate" values={String(clamp(1 + g.saturation * 0.35, 0, 2))} />
        </filter>
      ))}
    </defs>
  </svg>
);

// ---------------------------------------------------------------------------
// One shot: reframed onto the person, optionally slowly moving, graded, with
// short sound fades at the ends so cuts never click.

const SegmentView: React.FC<{ seg: ClipSegment; keepAudio: boolean; frames: number; hasGrade: boolean }> = ({ seg, keepAudio, frames, hasGrade }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const t = interpolate(frame, [0, Math.max(1, frames - 1)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  const base = seg.crop ?? 1;
  const z =
    seg.zoom === "punch"
      ? base * (seg.crop ? 1.12 : 1.2)
      : seg.zoom === "in"
        ? base * (1 + 0.1 * t)
        : seg.zoom === "out"
          ? base * (1.1 - 0.1 * t)
          : base;
  const fx0 = seg.focusX ?? 0.5;
  const fy0 = seg.focusY ?? 0.38;
  const fx = seg.zoom === "pan" ? fx0 + ((seg.focusEndX ?? fx0) - fx0) * t : fx0;
  const fy = seg.zoom === "pan" ? fy0 + ((seg.focusEndY ?? fy0) - fy0) * t : fy0;
  const filter = hasGrade && seg.grade !== undefined ? `url(#grade${seg.grade})` : undefined;

  const fin = seg.audioFadeIn ?? 3;
  const fout = seg.audioFadeOut ?? 3;
  const volume = (f: number) =>
    Math.min(fin > 0 ? interpolate(f, [0, fin], [0, 1], { extrapolateRight: "clamp" }) : 1, fout > 0 ? interpolate(f, [frames - fout, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1);
  const trimBefore = Math.round(seg.start * FPS);
  const common = { src: seg.src, trimBefore, playbackRate: seg.playbackRate } as const;

  const srcAspect = seg.srcWidth / Math.max(1, seg.srcHeight);
  const pad = seg.layout === "blur-pad" && Math.abs(srcAspect - W / H) > 0.08;
  if (pad) {
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <AbsoluteFill style={{ transform: "scale(1.25)", filter: "blur(38px) brightness(0.55)" }}>
          <OffthreadVideo {...common} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </AbsoluteFill>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${z})` }}>
          <OffthreadVideo {...common} muted={!keepAudio} volume={volume} style={{ width: "100%", height: "100%", objectFit: "contain", filter }} />
        </AbsoluteFill>
        {seg.textOverlay ? <OverlayText text={seg.textOverlay} frames={frames} /> : null}
      </AbsoluteFill>
    );
  }
  // Fill: scale to cover, then place so the focus point sits in the middle (clamped to the edges).
  const cover = Math.max(W / Math.max(1, seg.srcWidth), H / Math.max(1, seg.srcHeight));
  const dw = seg.srcWidth * cover * z;
  const dh = seg.srcHeight * cover * z;
  const x = clamp(W / 2 - fx * dw, W - dw, 0);
  const y = clamp(H * 0.45 - fy * dh, H - dh, 0);
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: x, top: y, width: dw, height: dh }}>
        <OffthreadVideo {...common} muted={!keepAudio} volume={volume} style={{ width: "100%", height: "100%", objectFit: "cover", filter }} />
      </div>
      {seg.textOverlay ? <OverlayText text={seg.textOverlay} frames={frames} /> : null}
    </AbsoluteFill>
  );
};

const OverlayText: React.FC<{ text: string; frames: number }> = ({ text, frames }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 8, frames - 8, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const te = isTelugu(text);
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

const Hook: React.FC<{ text: string; look: CaptionLookProps }> = ({ text, look }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 6, 60, 72], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(frame, [0, 8], [20, 0], { extrapolateRight: "clamp" });
  const te = isTelugu(text);
  const hand = look.font === "handwritten" || look.font === "elegant";
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
          fontFamily: te ? FONTS.teluguSans : hand ? fontFor(look.font) : FONTS.bold,
          fontWeight: hand ? 600 : 800,
          fontSize: te ? 50 : hand ? 66 : 60,
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

// Where on-video text sits. Instagram's buttons cover the bottom ~20% and right edge.
function placement(look: CaptionLookProps): React.CSSProperties {
  if (look.position === "upper") return { justifyContent: "flex-start", alignItems: "center", paddingTop: 400 };
  if (look.position === "lower") return { justifyContent: "flex-end", alignItems: "center", paddingBottom: 470 };
  return { justifyContent: "center", alignItems: "center", paddingTop: 260 };
}

function textBox(look: CaptionLookProps, te: boolean): React.CSSProperties {
  return {
    maxWidth: 920,
    textAlign: "center",
    color: look.color || "#fff",
    textTransform: look.uppercase && !te ? "uppercase" : undefined,
    textShadow: look.background === "none" ? undefined : "0 4px 22px rgba(0,0,0,0.6)",
    WebkitTextStroke: look.background === "shadow" && !te && look.font === "bold" ? "2px rgba(0,0,0,0.75)" : undefined,
    paintOrder: "stroke fill",
    ...(look.background === "box" ? { background: "rgba(0,0,0,0.55)", padding: "14px 28px", borderRadius: 18 } : {}),
  };
}

const Captions: React.FC<{ props: ClipEditProps; accent: string; look: CaptionLookProps }> = ({ props, accent, look }) => {
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
  if (pages.length === 0) return null;
  const page = pages.find((p, i) => ms >= p.startMs && ms < (pages[i + 1]?.startMs ?? p.startMs + p.durationMs));
  if (!page || ms > page.startMs + page.durationMs + 400) return null;
  const hi = look.highlight || accent;
  return (
    <AbsoluteFill style={placement(look)}>
      <div
        style={{
          ...textBox(look, te),
          fontFamily: fontFor(look.font, te),
          fontWeight: look.font === "bold" ? 800 : 600,
          fontSize: (te ? 54 : look.font === "handwritten" ? 80 : 66) * SIZE[look.size],
          lineHeight: te ? 1.5 : 1.15,
        }}
      >
        {page.tokens.map((t, i) => {
          const active = props.captions.style === "karaoke" && ms >= t.fromMs && ms < t.toMs;
          return (
            <span key={i} style={{ whiteSpace: "pre", color: active ? hi : undefined, display: "inline-block", transform: active ? "scale(1.08)" : undefined }}>
              {t.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

// Big 1-3 word captions, with key words in the highlight colour and an accent script font.
const PopCaptions: React.FC<{ props: ClipEditProps; accent: string; look: CaptionLookProps }> = ({ props, accent, look }) => {
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
  const hi = look.highlight || accent;
  const pos = placement(look);
  return (
    <AbsoluteFill style={look.position === "middle" ? { justifyContent: "center", alignItems: "center", paddingTop: 520 } : pos}>
      <div
        style={{
          ...textBox(look, te),
          WebkitTextStroke: undefined,
          lineHeight: te ? 1.35 : 0.98,
          transform: `scale(${0.82 + 0.18 * pop})`,
          opacity: Math.min(1, pop * 1.4),
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
                color: isEmph ? hi : look.color || "#fff",
                fontFamily: isEmph && !te ? FONTS.display : fontFor(look.font === "bold" ? "clean" : look.font, te),
                fontStyle: isEmph && !te ? "italic" : "normal",
                fontWeight: isEmph ? 500 : 700,
                fontSize: (te ? 80 : long ? 104 : 128) * (isEmph ? 1.08 : 1) * SIZE[look.size],
                letterSpacing: isEmph || look.font === "handwritten" ? 0 : -3,
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

// Worship lyrics: one sung line at a time, fading and drifting in gently.
const Lyrics: React.FC<{ lines: NonNullable<ClipEditProps["lyrics"]>; look: CaptionLookProps; accent: string }> = ({ lines, look, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const line = lines.find((l) => ms >= l.startMs - 150 && ms < l.endMs + 250);
  if (!line) return null;
  const te = isTelugu(line.text);
  const local = ms - (line.startMs - 150);
  const total = line.endMs + 250 - (line.startMs - 150);
  const o = interpolate(local, [0, 260, total - 260, total], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(local, [0, 400], [16, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.ease) });
  const font = look.font === "bold" ? "elegant" : look.font;
  return (
    <AbsoluteFill style={placement(look.position === "middle" ? { ...look, position: "lower" } : look)}>
      <div
        style={{
          ...textBox(look, te),
          WebkitTextStroke: undefined,
          opacity: o,
          transform: `translateY(${y}px)`,
          fontFamily: fontFor(font, te),
          fontWeight: te ? 700 : 500,
          fontStyle: font === "elegant" && !te ? "italic" : "normal",
          fontSize: (te ? 56 : font === "handwritten" ? 84 : 70) * SIZE[look.size],
          lineHeight: te ? 1.55 : 1.2,
        }}
      >
        {line.text}
        <div style={{ margin: "14px auto 0", height: 3, width: interpolate(local, [0, 600], [0, 140], { extrapolateRight: "clamp" }), background: look.highlight || accent, borderRadius: 2, opacity: 0.85 }} />
      </div>
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ title: string; subtitle?: string; accent: string; frames: number }> = ({ title, subtitle, accent, frames }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 12, frames - 12, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const x = interpolate(frame, [0, 14], [-30, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.ease) });
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 70,
          top: 230,
          opacity: o,
          transform: `translateX(${x}px)`,
          display: "flex",
          gap: 18,
          alignItems: "center",
          background: "rgba(0,0,0,0.42)",
          padding: "16px 28px 16px 20px",
          borderRadius: 20,
          borderLeft: `5px solid ${accent}`,
          maxWidth: 820,
        }}
      >
        <div style={{ fontSize: 46, color: accent, lineHeight: 1 }}>♪</div>
        <div>
          <div style={{ fontFamily: isTelugu(title) ? FONTS.teluguSans : FONTS.display, fontSize: 44, color: "#fff", lineHeight: 1.2 }}>{title}</div>
          {subtitle ? (
            <div style={{ fontFamily: isTelugu(subtitle) ? FONTS.teluguSans : FONTS.sans, fontSize: 28, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>{subtitle}</div>
          ) : null}
        </div>
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
  const look = { ...DEFAULT_LOOK, ...(props.captions.look ?? {}) };
  const body = segs.reduce((a, s) => a + segFrames(s), 0) - (props.transition === "fade" && segs.length > 1 ? TRANSITION_FRAMES * (segs.length - 1) : 0);
  const outroFrames = props.brand.outro.enabled ? Math.round(props.brand.outro.seconds * FPS) : 0;
  const grades = props.grades ?? [];
  // Frames where one segment hands over to the next (for whoosh sounds).
  const cutFrames: number[] = [];
  {
    let acc = 0;
    segs.forEach((sg, i) => {
      acc += segFrames(sg) - (props.transition === "fade" && i < segs.length - 1 ? TRANSITION_FRAMES : 0);
      if (i < segs.length - 1 && segs[i + 1].src !== sg.src) cutFrames.push(acc);
    });
  }
  const bed = props.audioBed;
  const segAudio = props.keepAudio && !bed;
  const captionStyle = props.captions.style;
  const hasLyrics = (props.lyrics?.length ?? 0) > 0;
  const titleFrom = props.hook ? 75 : 12;
  return (
    <FontGate>
      <AbsoluteFill style={{ background: "#000" }}>
        {grades.length ? <GradeDefs grades={grades} /> : null}
        <Sequence durationInFrames={body}>
          <TransitionSeries>
            {segs.flatMap((s, i) => {
              const f = segFrames(s);
              const items = [
                <TransitionSeries.Sequence key={`s${i}`} durationInFrames={f}>
                  <SegmentView seg={s} keepAudio={segAudio} frames={f} hasGrade={grades.length > 0} />
                </TransitionSeries.Sequence>,
              ];
              if (props.transition === "fade" && i < segs.length - 1) {
                items.push(<TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />);
              }
              return items;
            })}
          </TransitionSeries>
          {bed && props.keepAudio ? (
            <Audio
              src={bed.src}
              trimBefore={Math.round(bed.start * FPS)}
              volume={(f) =>
                Math.min(
                  interpolate(f, [0, 6], [0, 1], { extrapolateRight: "clamp" }),
                  interpolate(f, [body - bed.fadeOutFrames, body], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                )
              }
            />
          ) : null}
          {hasLyrics ? (
            <Lyrics lines={props.lyrics!} look={look} accent={props.brand.accent} />
          ) : captionStyle === "none" || props.captions.words.length === 0 ? null : captionStyle === "pop" ? (
            <PopCaptions props={props} accent={props.brand.accent} look={look} />
          ) : (
            <Captions props={props} accent={props.brand.accent} look={look} />
          )}
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
          {props.titleCard?.title && body > titleFrom + 60 ? (
            <Sequence from={titleFrom} durationInFrames={Math.min(135, body - titleFrom)}>
              <TitleCard title={props.titleCard.title} subtitle={props.titleCard.subtitle} accent={props.brand.accent} frames={Math.min(135, body - titleFrom)} />
            </Sequence>
          ) : null}
          {props.hook ? <Hook text={props.hook} look={look} /> : null}
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
