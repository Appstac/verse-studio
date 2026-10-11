import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { FONTS } from "../fonts";
import type { BrandProps } from "../types";

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
  if (!brand.signatureText && !brand.logoSrc) return null;
  const fadeIn =
    durationInFrames <= 1 ? 1 : interpolate(frame, [4, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut =
    hideAfterFrame !== undefined
      ? interpolate(frame, [hideAfterFrame, hideAfterFrame + 10], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
  const isSlide = h < 1500;
  const pos: React.CSSProperties = {};
  const p = brand.position;
  if (p.startsWith("bottom")) pos.bottom = isSlide ? 56 : 360;
  else pos.top = isSlide ? 56 : 170;
  if (p.endsWith("left")) pos.left = 84;
  else if (p.endsWith("right")) pos.right = 160;
  else {
    pos.left = 0;
    pos.right = 0;
  }
  const justify = p.endsWith("left") ? "flex-start" : p.endsWith("right") ? "flex-end" : "center";
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          ...pos,
          display: "flex",
          justifyContent: justify,
          alignItems: "center",
          gap: 16,
          opacity: brand.opacity * fadeIn * fadeOut,
        }}
      >
        {brand.logoSrc ? (
          <Img
            src={brand.logoSrc}
            style={{ width: 58, height: 58, borderRadius: 29, objectFit: "cover", border: `2px solid ${color}` }}
          />
        ) : null}
        {brand.signatureText ? (
          <span style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 32, letterSpacing: 1.5, color }}>
            {brand.signatureText}
          </span>
        ) : null}
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
        {brand.logoSrc ? (
          <Img src={brand.logoSrc} style={{ width: 150, height: 150, borderRadius: 75, objectFit: "cover", border: `3px solid ${accent}` }} />
        ) : null}
        <div style={{ fontFamily: FONTS.display, fontSize: 64, color, textAlign: "center", lineHeight: 1.2 }}>{brand.handle}</div>
        <div style={{ height: 2, width: line, background: accent, opacity: 0.85 }} />
        <div style={{ fontFamily: FONTS.sans, fontWeight: 500, fontSize: 40, color: muted, textAlign: "center", lineHeight: 1.4 }}>
          {brand.outro.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
