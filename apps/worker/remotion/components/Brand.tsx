import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { FONTS } from "../fonts";
import type { BrandProps, TextFontName } from "../types";

export const fontFor = (f: TextFontName | undefined, telugu = false) =>
  telugu
    ? f === "elegant" || f === "classic"
      ? FONTS.teluguSerif
      : FONTS.teluguSans
    : f === "bold"
      ? FONTS.bold
      : f === "elegant"
        ? FONTS.display
        : f === "classic"
          ? FONTS.serif
          : f === "handwritten"
            ? FONTS.hand
            : FONTS.sans;

// Instagram's own UI covers roughly the bottom 20% and the right edge of a Reel,
// so the signature sits just above that area by default.
export const Signature: React.FC<{ brand: BrandProps; color: string; hideAfterFrame?: number; frameHeight?: number }> = ({
  brand,
  color,
  hideAfterFrame,
  frameHeight,
}) => {
  const frame = useCurrentFrame();
  const { height, durationInFrames } = useVideoConfig();
  const h = frameHeight ?? height;
  const wm = brand.watermark;
  if (wm && !wm.enabled) return null;
  const showLogo = !!brand.logoSrc && (wm ? wm.showLogo : true);
  if (!brand.signatureText && !showLogo) return null;
  const fadeIn =
    durationInFrames <= 1 ? 1 : interpolate(frame, [4, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut =
    hideAfterFrame !== undefined
      ? interpolate(frame, [hideAfterFrame, hideAfterFrame + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
  const { width } = useVideoConfig();
  const land = width > h;
  const isSlide = !land && h < 1500;
  const pos: React.CSSProperties = {};
  const p = brand.position;
  // Reels: keep clear of Instagram's buttons and caption. YouTube: close to the edges.
  if (p.startsWith("bottom")) pos.bottom = land ? 60 : isSlide ? 56 : 360;
  else pos.top = land ? 50 : isSlide ? 56 : 170;
  if (p.endsWith("left")) pos.left = land ? 70 : 84;
  else if (p.endsWith("right")) pos.right = land ? 70 : isSlide ? 84 : 170;
  else {
    pos.left = 0;
    pos.right = 0;
  }
  const justify = p.endsWith("left") ? "flex-start" : p.endsWith("right") ? "flex-end" : "center";
  const size = (wm?.size ?? 32) * (isSlide ? 0.85 : land ? 0.9 : 1);
  const ink = wm?.color || color;
  const style = wm?.style ?? "shadow";
  const textStyle: React.CSSProperties = {
    fontFamily: fontFor(wm?.font ?? "clean", /[\u0C00-\u0C7F]/.test(brand.signatureText)),
    fontWeight: wm?.font === "handwritten" ? 600 : wm?.font === "bold" ? 800 : 600,
    fontSize: size,
    letterSpacing: wm?.font === "handwritten" || wm?.font === "elegant" ? 0 : 1.5,
    color: ink,
    textShadow: style === "shadow" ? "0 2px 10px rgba(0,0,0,0.55)" : undefined,
    WebkitTextStroke: style === "outline" ? `${Math.max(1, size / 22)}px rgba(0,0,0,0.85)` : undefined,
    paintOrder: "stroke fill",
  };
  const logo = Math.round(size * 1.8);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...pos,
          display: "flex",
          justifyContent: justify,
          alignItems: "center",
          opacity: brand.opacity * fadeIn * fadeOut,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: Math.round(size / 2),
            ...(style === "pill" ? { background: "rgba(0,0,0,0.45)", padding: `${size * 0.3}px ${size * 0.7}px`, borderRadius: 999 } : {}),
          }}
        >
          {showLogo ? (
            <Img src={brand.logoSrc!} style={{ width: logo, height: logo, borderRadius: logo / 2, objectFit: "cover", border: `2px solid ${ink}` }} />
          ) : null}
          {brand.signatureText ? <span style={textStyle}>{brand.signatureText}</span> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Outro: React.FC<{ brand: BrandProps; startFrame: number; color: string; muted: string; accent: string }> = ({
  brand,
  startFrame,
  color,
  muted,
  accent,
}) => {
  const frame = useCurrentFrame() - startFrame;
  if (!brand.outro.enabled || frame < 0) return null;
  const o = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const y = interpolate(frame, [0, 14], [30, 0], { extrapolateRight: "clamp" });
  const line = interpolate(frame, [6, 22], [0, 220], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: o, transform: `translateY(${y}px)` }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, padding: "0 120px" }}>
        {brand.logoSrc && brand.outro.showLogo !== false ? (
          <Img src={brand.logoSrc} style={{ width: 150, height: 150, borderRadius: 75, objectFit: "cover", border: `3px solid ${accent}` }} />
        ) : null}
        <div style={{ fontFamily: FONTS.display, fontSize: 64, color, textAlign: "center", lineHeight: 1.2 }}>{brand.outro.title || brand.handle}</div>
        <div style={{ height: 2, width: line, background: accent, opacity: 0.85 }} />
        {brand.outro.text
          ? brand.outro.text.split(/\n+/).map((t, i) => (
              <div
                key={i}
                style={{ fontFamily: /[\u0C00-\u0C7F]/.test(t) ? FONTS.teluguSans : FONTS.sans, fontWeight: 500, fontSize: 40, color: muted, textAlign: "center", lineHeight: 1.4 }}
              >
                {t}
              </div>
            ))
          : null}
      </div>
    </AbsoluteFill>
  );
};
