import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Img,
  Loop,
  OffthreadVideo,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { MediaRef, PresetName } from "../types";

const Grain: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const seed = frame % 6;
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={`g${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.55 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,${strength}) 100%)`,
    }}
  />
);

const Particles: React.FC<{ count: number; seed: number; color: string; size: [number, number]; blur: number; rise: number }> = ({
  count,
  seed,
  color,
  size,
  blur,
  rise,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const parts = useMemo(
    () =>
      new Array(count).fill(0).map((_, i) => ({
        x: random(`${seed}-x-${i}`) * width,
        y: random(`${seed}-y-${i}`) * height,
        r: size[0] + random(`${seed}-r-${i}`) * (size[1] - size[0]),
        speed: 0.3 + random(`${seed}-s-${i}`) * 0.9,
        phase: random(`${seed}-p-${i}`) * Math.PI * 2,
        drift: (random(`${seed}-d-${i}`) - 0.5) * 0.6,
      })),
    [count, seed, width, height, size],
  );
  return (
    <AbsoluteFill>
      {parts.map((p, i) => {
        const y = (((p.y - frame * p.speed * rise) % height) + height) % height;
        const x = p.x + Math.sin(frame / 40 + p.phase) * 18 + frame * p.drift;
        const o = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(frame / 22 + p.phase));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: p.r,
              height: p.r,
              borderRadius: "50%",
              background: color,
              opacity: o,
              filter: blur ? `blur(${blur}px)` : undefined,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Stars: React.FC<{ seed: number }> = ({ seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const stars = useMemo(
    () =>
      new Array(140).fill(0).map((_, i) => ({
        x: random(`${seed}-sx-${i}`) * width,
        y: random(`${seed}-sy-${i}`) * height * 0.8,
        r: 1 + random(`${seed}-sr-${i}`) * 2.6,
        p: random(`${seed}-sp-${i}`) * Math.PI * 2,
      })),
    [seed, width, height],
  );
  return (
    <AbsoluteFill>
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: s.x,
            top: s.y,
            width: s.r,
            height: s.r,
            borderRadius: "50%",
            background: "#fff",
            opacity: 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(frame / 18 + s.p)),
            boxShadow: s.r > 2.6 ? "0 0 8px rgba(255,255,255,0.8)" : undefined,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

const MediaBg: React.FC<{ media: MediaRef }> = ({ media }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.16]);
  const style: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: `scale(${scale})`,
  };
  if (media.type === "image") return <Img src={media.src} style={style} />;
  const loopFrames = Math.max(fps, Math.floor((media.durationSeconds ?? 10) * fps) - 2);
  return (
    <Loop durationInFrames={loopFrames}>
      <OffthreadVideo src={media.src} muted style={style} />
    </Loop>
  );
};

export const Background: React.FC<{ preset: PresetName; seed: number; media?: MediaRef; still?: boolean }> = ({
  preset,
  seed,
  media,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = durationInFrames > 1 ? frame / durationInFrames : 0.5;

  if (preset === "photo" && media) {
    return (
      <AbsoluteFill style={{ background: "#000" }}>
        <MediaBg media={media} />
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.55) 40%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0.75) 100%)",
          }}
        />
        <Grain opacity={0.12} />
      </AbsoluteFill>
    );
  }

  switch (preset) {
    case "night": {
      const ax = 30 + Math.sin(t * Math.PI * 2) * 12;
      return (
        <AbsoluteFill style={{ background: "linear-gradient(180deg,#03050f 0%,#0b1430 45%,#1c2a55 100%)" }}>
          <Stars seed={seed} />
          <AbsoluteFill
            style={{
              background: `radial-gradient(ellipse 70% 35% at ${ax}% 78%, rgba(120,170,255,0.30), rgba(0,0,0,0) 70%), radial-gradient(ellipse 60% 30% at ${100 - ax}% 85%, rgba(190,140,255,0.22), rgba(0,0,0,0) 70%)`,
              filter: "blur(10px)",
            }}
          />
          <Vignette strength={0.5} />
          <Grain opacity={0.1} />
        </AbsoluteFill>
      );
    }
    case "paper":
      return (
        <AbsoluteFill style={{ background: "#F2E8D5" }}>
          <AbsoluteFill style={{ opacity: 0.55, mixBlendMode: "multiply" }}>
            <svg width="100%" height="100%">
              <filter id="paper">
                <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" seed={seed % 100} />
                <feColorMatrix type="matrix" values="0 0 0 0 0.85  0 0 0 0 0.78  0 0 0 0 0.66  0 0 0 0.35 0" />
              </filter>
              <rect width="100%" height="100%" filter="url(#paper)" />
            </svg>
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              background: `radial-gradient(ellipse 80% 60% at ${20 + t * 20}% 10%, rgba(255,240,200,0.6), rgba(0,0,0,0) 70%)`,
            }}
          />
          <AbsoluteFill
            style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(80,50,20,0.28) 100%)" }}
          />
          <Grain opacity={0.08} />
        </AbsoluteFill>
      );
    case "minimal": {
      const x = 20 + 60 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 + seed));
      return (
        <AbsoluteFill style={{ background: "#0A0A0B" }}>
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle 900px at ${x}% 30%, rgba(255,255,255,0.10), rgba(0,0,0,0) 70%)`,
            }}
          />
          <Grain opacity={0.14} />
        </AbsoluteFill>
      );
    }
    case "garden":
      return (
        <AbsoluteFill style={{ background: "linear-gradient(165deg,#0e2416 0%,#244a2c 50%,#7f9c5e 100%)" }}>
          <Particles count={16} seed={seed} color="rgba(255,244,200,0.35)" size={[60, 220]} blur={22} rise={0.5} />
          <AbsoluteFill
            style={{
              background: `radial-gradient(ellipse 90% 50% at 70% ${12 + t * 6}%, rgba(255,236,170,0.35), rgba(0,0,0,0) 70%)`,
            }}
          />
          <Vignette strength={0.55} />
          <Grain opacity={0.1} />
        </AbsoluteFill>
      );
    case "dawn":
    default: {
      const glowY = interpolate(t, [0, 1], [92, 78]);
      return (
        <AbsoluteFill style={{ background: "linear-gradient(180deg,#140b08 0%,#3b2014 38%,#8a4a26 72%,#d58c4c 100%)" }}>
          <AbsoluteFill
            style={{
              background: `radial-gradient(ellipse 85% 45% at 50% ${glowY}%, rgba(255,210,140,0.75), rgba(255,160,80,0.18) 45%, rgba(0,0,0,0) 72%)`,
            }}
          />
          <Particles count={46} seed={seed} color="rgba(255,226,170,0.9)" size={[2, 6]} blur={1} rise={0.7} />
          <Vignette strength={0.6} />
          <Grain opacity={0.11} />
        </AbsoluteFill>
      );
    }
  }
};
