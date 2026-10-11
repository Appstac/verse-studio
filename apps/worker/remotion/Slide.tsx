import React from "react";
import { AbsoluteFill } from "remotion";
import { Background } from "./components/Background";
import { Signature } from "./components/Brand";
import { FONTS, FontGate } from "./fonts";
import { presetStyle } from "./presets";
import type { SlideProps } from "./types";

export const Slide: React.FC<SlideProps> = (p) => {
  const te = p.language === "telugu";
  const st = presetStyle(p.preset, p.language, p.brand.accent);
  const titleFont = te ? FONTS.teluguSerif : FONTS.display;
  const bodyFont = te ? FONTS.teluguSans : FONTS.sans;
  const counter = `${String(p.index + 1).padStart(2, "0")} / ${String(p.total).padStart(2, "0")}`;

  const titleSize =
    p.kind === "cover"
      ? Math.max(64, Math.min(104, 130 - p.title.length * 0.9))
      : Math.max(52, Math.min(76, 92 - p.title.length * 0.5));

  return (
    <FontGate>
      <AbsoluteFill style={{ background: "#000" }}>
        <Background preset={p.preset} seed={p.seed} media={p.background} />
        <AbsoluteFill style={{ padding: "120px 96px 150px", justifyContent: "center", color: st.text }}>
          {p.kind === "body" ? (
            <div style={{ fontFamily: FONTS.display, fontSize: 120, color: st.accent, opacity: 0.9, lineHeight: 1 }}>
              {String(p.index).padStart(2, "0")}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: titleFont,
              fontStyle: !te && p.kind === "cover" && p.preset !== "minimal" ? "italic" : "normal",
              fontWeight: p.preset === "minimal" ? 800 : 500,
              fontSize: (te ? 0.8 : 1) * titleSize,
              lineHeight: te ? 1.45 : 1.12,
              marginTop: p.kind === "body" ? 24 : 0,
              textShadow: st.shadow,
              textAlign: p.kind === "body" ? "left" : "center",
            }}
          >
            {p.title}
          </div>
          {p.body ? (
            <div
              style={{
                fontFamily: bodyFont,
                fontWeight: 400,
                fontSize: te ? 36 : 42,
                lineHeight: te ? 1.7 : 1.5,
                color: st.muted,
                marginTop: 40,
                textAlign: p.kind === "body" ? "left" : "center",
              }}
            >
              {p.body}
            </div>
          ) : null}
          {p.reference ? (
            <div
              style={{
                marginTop: 44,
                fontFamily: FONTS.sans,
                fontWeight: 600,
                fontSize: 30,
                letterSpacing: 5,
                color: st.accent,
                textTransform: "uppercase",
                textAlign: p.kind === "body" ? "left" : "center",
              }}
            >
              {p.reference}
            </div>
          ) : null}
          {p.kind === "cta" ? (
            <div style={{ marginTop: 60, textAlign: "center", fontFamily: FONTS.display, fontSize: 54, color: st.text }}>
              {p.brand.handle}
            </div>
          ) : null}
        </AbsoluteFill>
        <div
          style={{
            position: "absolute",
            top: 64,
            right: 80,
            fontFamily: FONTS.sans,
            fontWeight: 600,
            fontSize: 26,
            letterSpacing: 4,
            color: st.muted,
          }}
        >
          {counter}
        </div>
        {p.kind === "cover" ? (
          <div
            style={{
              position: "absolute",
              bottom: 64,
              right: 80,
              fontFamily: FONTS.sans,
              fontWeight: 600,
              fontSize: 28,
              letterSpacing: 6,
              color: st.accent,
            }}
          >
            SWIPE →
          </div>
        ) : null}
        <Signature
          brand={{ ...p.brand, position: "bottom-left" }}
          color={st.muted}
          frameHeight={1350}
        />
      </AbsoluteFill>
    </FontGate>
  );
};
