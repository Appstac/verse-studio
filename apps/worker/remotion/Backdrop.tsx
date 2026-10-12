// Animated worship "light effect" backdrops for the virtual green screen (real
// photo and video backgrounds come from the stock library instead).
// Every preset = lighting setup × colour palette. Everything is laid out in fractions of the
// frame, so the same preset works for vertical Reels and horizontal YouTube videos.
// All motion repeats every 8 seconds, so a short render loops seamlessly.
import React, { useMemo } from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import { BACKDROP_LIGHTS, BACKDROP_PALETTES, type BackdropProps } from "./types";

const LOOP = 240;
const TAU = Math.PI * 2;
const wave = (f: number, k = 1, phase = 0) => Math.sin((f / LOOP) * TAU * k + phase);
const a = (hex: string, alpha: number) => `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0")}`;

type Pal = (typeof BACKDROP_PALETTES)[number];
interface G {
  W: number;
  H: number;
  u: number; // 1 unit = 1px on a 1080-wide reel; scales with the short side
  land: boolean;
  f: number;
  p: Pal;
  seed: number;
}

// ---------------------------------------------------------------------------
// Shared pieces

const Abs: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode }> = ({ style, children }) => (
  <div style={{ position: "absolute", ...style }}>{children}</div>
);

const Glow: React.FC<{ x: number; y: number; r: number; color: string; alpha: number }> = ({ x, y, r, color, alpha }) => (
  <Abs style={{ left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%", background: `radial-gradient(circle, ${a(color, alpha)} 0%, ${a(color, alpha * 0.35)} 40%, transparent 70%)`, mixBlendMode: "screen" }} />
);

const Grain: React.FC = () => (
  <AbsoluteFill style={{ opacity: 0.07, mixBlendMode: "overlay" }}>
    <svg width="100%" height="100%">
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={5} />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  </AbsoluteFill>
);

const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.6 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0) 38%, rgba(0,0,0,${strength}) 100%)` }} />
);

const Haze: React.FC<{ color: string; opacity: number; g: G; shift?: number }> = ({ color, opacity, g, shift = 0 }) => (
  <AbsoluteFill style={{ opacity: opacity * 0.8, mixBlendMode: "screen", filter: `blur(${28 * g.u}px)` }}>
    <svg width="100%" height="100%" viewBox={`0 0 ${g.W} ${g.H}`} preserveAspectRatio="none">
      <filter id={`haze${shift}`}>
        <feTurbulence type="fractalNoise" baseFrequency={`${0.004 / g.u} ${0.009 / g.u}`} numOctaves="3" seed={3 + shift} />
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.7 -0.15" />
      </filter>
      <rect x={-0.2 * g.W + 0.1 * g.W * wave(g.f + shift * 40)} y={-0.05 * g.H} width={1.4 * g.W} height={1.1 * g.H} filter={`url(#haze${shift})`} fill={color} />
    </svg>
  </AbsoluteFill>
);

const Floor: React.FC<{ g: G }> = ({ g }) => (
  <Abs
    style={{
      left: 0,
      right: 0,
      top: g.H * 0.66,
      bottom: 0,
      background: `radial-gradient(ellipse 70% 40% at 50% 22%, ${a(g.p.light, 0.16 + 0.06 * wave(g.f))}, transparent 70%), linear-gradient(180deg, transparent 0%, ${a(g.p.bg2, 0.8)} 30%, #000 100%)`,
    }}
  />
);

function Bokeh({ g, n = 26, seed = 1, region = [0, 1], size = [40, 180], colors }: { g: G; n?: number; seed?: number; region?: [number, number]; size?: [number, number]; colors?: string[] }) {
  const cols = colors ?? [g.p.light, g.p.accent];
  const dots = useMemo(
    () =>
      new Array(n).fill(0).map((_, i) => ({
        x: random(`bx${seed}${i}`),
        y: region[0] + random(`by${seed}${i}`) * (region[1] - region[0]),
        r: size[0] + random(`br${seed}${i}`) * (size[1] - size[0]),
        k: 1 + Math.floor(random(`bk${seed}${i}`) * 2),
        ph: random(`bp${seed}${i}`) * TAU,
        c: Math.floor(random(`bc${seed}${i}`) * cols.length),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, seed, cols.length],
  );
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      {dots.map((d, i) => {
        const r = d.r * g.u;
        const c = cols[d.c];
        return (
          <Abs
            key={i}
            style={{
              left: d.x * g.W + 24 * g.u * wave(g.f, d.k, d.ph) - r,
              top: d.y * g.H + 30 * g.u * wave(g.f, 1, d.ph + 1) - r,
              width: r * 2,
              height: r * 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${a(c, 0.65)} 0%, ${a(c, 0.28)} 55%, transparent 72%)`,
              opacity: 0.45 + 0.3 * (0.5 + 0.5 * wave(g.f, d.k, d.ph)),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

// A glowing cross.
const WallCross: React.FC<{ g: G; x: number; y: number; h: number; color: string; glow: string }> = ({ g, x, y, h, color, glow }) => {
  const t = h * 0.13;
  return (
    <Abs style={{ left: x - h * 0.3, top: y - h / 2, width: h * 0.6, height: h, filter: `drop-shadow(0 0 ${30 * g.u}px ${glow})` }}>
      <Abs style={{ left: h * 0.3 - t / 2, top: 0, width: t, height: h, background: `linear-gradient(90deg, ${color}, ${a("#ffffff", 0.18)}, ${color})`, borderRadius: t * 0.15 }} />
      <Abs style={{ left: 0, top: h * 0.25, width: h * 0.6, height: t, background: `linear-gradient(180deg, ${color}, ${a("#ffffff", 0.15)}, ${color})`, borderRadius: t * 0.15 }} />
    </Abs>
  );
};

// ---------------------------------------------------------------------------
// Worship stage looks

function Beams({ g, count, from = "top" }: { g: G; count?: number; from?: "top" | "bottom" }) {
  const { W, H, u, p, f } = g;
  const n = count ?? Math.max(6, Math.round(W / (180 * u)));
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      {new Array(n).fill(0).map((_, i) => {
        const x = ((i + 0.5) / n) * W;
        const ang = (i - (n - 1) / 2) * (g.land ? 6 : 9) + 14 * wave(f, 1, i * 1.3);
        const col = i % 2 ? p.light : p.accent;
        return (
          <Abs
            key={i}
            style={{
              left: x - 70 * u,
              top: from === "top" ? -80 * u : undefined,
              bottom: from === "bottom" ? -80 * u : undefined,
              width: 140 * u,
              height: Math.hypot(W, H) * 1.1,
              transformOrigin: from === "top" ? "50% 0%" : "50% 100%",
              transform: `rotate(${ang}deg)`,
              background: `linear-gradient(${from === "top" ? 180 : 0}deg, ${a(col, 0.8)} 0%, ${a(col, 0.2)} 45%, transparent 85%)`,
              clipPath: from === "top" ? "polygon(42% 0, 58% 0, 100% 100%, 0 100%)" : "polygon(0 0, 100% 0, 58% 100%, 42% 100%)",
              filter: `blur(${14 * u}px)`,
              opacity: 0.55 + 0.25 * wave(f, 2, i),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function Stage({ id, g }: { id: string; g: G }) {
  const { W, H, u, p, f } = g;
  switch (id) {
    case "spotlight":
      return (
        <>
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 50% 62% at 50% ${38 + 2 * wave(f)}%, ${a(p.light, 0.8)}, ${a(p.light, 0.27)} 45%, transparent 78%)`, mixBlendMode: "screen" }} />
          <Haze color={p.light} opacity={0.18} g={g} />
          <Floor g={g} />
        </>
      );
    case "bokeh":
      return <Bokeh g={g} />;
    case "ledwall": {
      const cell = 72 * u;
      const cols = Math.floor((W * 0.92) / cell);
      const rows = Math.floor((H * 0.72) / cell);
      return (
        <>
          <Abs style={{ left: (W - cols * cell) / 2, top: H * 0.04, width: cols * cell, height: rows * cell, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 * u }}>
            {new Array(cols * rows).fill(0).map((_, i) => {
              const v = 0.5 + 0.5 * wave(f, 1, (i % cols) * 0.45 + Math.floor(i / cols) * 0.3);
              return <div key={i} style={{ borderRadius: 4 * u, background: v > 0.5 ? p.light : p.accent, opacity: 0.12 + 0.55 * v * v, boxShadow: `0 0 ${18 * u}px ${a(p.light, 0.4)}` }} />;
            })}
          </Abs>
          <Floor g={g} />
        </>
      );
    }
    case "haze":
      return (
        <>
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 50% at 50% 100%, ${a(p.light, 0.6)}, transparent 70%)`, mixBlendMode: "screen" }} />
          <Haze color={p.light} opacity={0.45} g={g} />
          <Haze color={p.accent} opacity={0.25} g={g} shift={1} />
        </>
      );
    case "cross":
      return (
        <>
          <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 34%, ${a(p.light, 0.6)}, ${a(p.light, 0.13)} 30%, transparent 60%)`, mixBlendMode: "screen", opacity: 0.85 + 0.15 * wave(f) }} />
          <WallCross g={g} x={W / 2} y={H * 0.34} h={Math.min(H * 0.42, 640 * u)} color={p.light} glow={p.light} />
          <Haze color={p.light} opacity={0.2} g={g} />
          <Floor g={g} />
        </>
      );
    case "candles": {
      const n = Math.max(7, Math.round(W / (120 * u)));
      return (
        <>
          <Bokeh g={g} n={18} seed={7} region={[0.6, 0.95]} />
          {new Array(n).fill(0).map((_, i) => {
            const x = W * (0.08 + (i / (n - 1)) * 0.84);
            const flick = 0.85 + 0.15 * wave(f, 6 + (i % 3), i * 2.1);
            const y = H * 0.76 + (i % 2) * 60 * u;
            return (
              <React.Fragment key={i}>
                <Glow x={x} y={y} r={90 * u * flick} color={p.light} alpha={0.8} />
                <Abs style={{ left: x - 10 * u, top: y - 46 * u, width: 20 * u, height: 46 * u * flick, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", background: "#fff3c4" }} />
                <Abs style={{ left: x - 30 * u, top: y + 4 * u, width: 60 * u, height: 170 * u, borderRadius: 8 * u, background: "linear-gradient(90deg,#d9c9a8,#f4ead2,#cbb991)", opacity: 0.85 }} />
              </React.Fragment>
            );
          })}
        </>
      );
    }
    case "clouds":
      return (
        <>
          <AbsoluteFill style={{ background: `linear-gradient(180deg, ${a(p.light, 0.4)}, transparent 60%)`, mixBlendMode: "screen" }} />
          <Haze color="#ffffff" opacity={0.5} g={g} />
          <Beams g={g} count={5} />
        </>
      );
    case "window": {
      const panes = ["#e8b04a", "#4a7be8", "#c94a6b", "#5fb37a", "#e8d24a", "#8a5fd1"];
      const ww = Math.min(W * 0.5, 520 * u);
      return (
        <>
          <Abs style={{ left: (W - ww) / 2, top: H * 0.08, width: ww, height: Math.min(H * 0.6, 900 * u), borderRadius: `${ww / 2}px ${ww / 2}px ${12 * u}px ${12 * u}px`, overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 * u, padding: 8 * u, background: "#111", boxShadow: `0 0 ${120 * u}px ${p.light}`, boxSizing: "border-box" }}>
            {new Array(24).fill(0).map((_, i) => (
              <div key={i} style={{ background: panes[(i * 5) % panes.length], opacity: 0.55 + 0.35 * (0.5 + 0.5 * wave(f, 1, i)) }} />
            ))}
          </Abs>
          <Beams g={g} count={4} />
          <Haze color={p.light} opacity={0.2} g={g} />
          <Floor g={g} />
        </>
      );
    }
    case "truss": {
      const n = Math.max(7, Math.round(W / (150 * u)));
      return (
        <>
          <Abs style={{ left: 0, right: 0, top: H * 0.06, height: 26 * u, background: `repeating-linear-gradient(90deg,#333 0 ${18 * u}px,#555 ${18 * u}px ${22 * u}px)`, opacity: 0.9 }} />
          {new Array(n).fill(0).map((_, i) => (
            <Abs key={i} style={{ left: W * (0.05 + (i / (n - 1)) * 0.9) - 26 * u, top: H * 0.06 + 20 * u, width: 52 * u, height: 52 * u, borderRadius: "50%", background: i % 2 ? p.light : p.accent, boxShadow: `0 0 ${50 * u}px ${18 * u}px ${i % 2 ? p.light : p.accent}`, opacity: 0.6 + 0.4 * (0.5 + 0.5 * wave(f, 2, i)) }} />
          ))}
          <Haze color={p.light} opacity={0.3} g={g} />
          <Beams g={g} count={n} />
          <Floor g={g} />
        </>
      );
    }
    case "curtain":
      return (
        <>
          <AbsoluteFill style={{ background: `repeating-linear-gradient(90deg, ${p.bg2} 0px, ${p.bg1} ${45 * u}px, ${p.bg2} ${90 * u}px)`, opacity: 0.9 }} />
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 40% 60% at 20% 100%, ${a(p.light, 0.67)}, transparent 70%), radial-gradient(ellipse 40% 60% at 80% 100%, ${a(p.accent, 0.67)}, transparent 70%)`, mixBlendMode: "screen", opacity: 0.8 + 0.2 * wave(f) }} />
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 50% 40% at 50% ${40 + 3 * wave(f)}%, ${a(p.light, 0.33)}, transparent 70%)`, mixBlendMode: "screen" }} />
        </>
      );
    case "dawn":
      return (
        <>
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 120% 45% at 50% ${80 - 3 * wave(f)}%, ${a(p.light, 0.93)}, ${a(p.accent, 0.4)} 40%, transparent 75%)`, mixBlendMode: "screen" }} />
          <Bokeh g={g} n={14} seed={3} />
          <Haze color={p.light} opacity={0.18} g={g} />
        </>
      );
    case "beams":
    default:
      return (
        <>
          <Haze color={p.light} opacity={0.25} g={g} />
          <Beams g={g} />
          <Floor g={g} />
        </>
      );
  }
}

export const Backdrop: React.FC<BackdropProps> = ({ light, palette, atFrame = 0 }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const pi = Math.max(0, BACKDROP_PALETTES.findIndex((x) => x.id === palette));
  const p = BACKDROP_PALETTES[pi];
  const id = BACKDROP_LIGHTS.some((l) => l.id === light) ? light : "beams";
  const g: G = { W, H, u: Math.min(W, H) / 1080, land: W > H, f: (frame + atFrame) % LOOP, p, seed: pi };
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, ${p.bg1}, ${p.bg2} 70%)`, overflow: "hidden" }}>
      <Stage id={id} g={g} />
      <Vignette strength={p.bright ? 0.25 : 0.6} />
      <Grain />
    </AbsoluteFill>
  );
};
