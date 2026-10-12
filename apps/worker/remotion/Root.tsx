import React from "react";
import { Composition, Still } from "remotion";
import { Backdrop } from "./Backdrop";
import { ClipEdit } from "./ClipEdit";
import { Slide } from "./Slide";
import { VerseReel } from "./VerseReel";
import {
  FORMAT_SIZE,
  FPS,
  REEL,
  SLIDE,
  clipEditFrames,
  verseReelFrames,
  type BackdropProps,
  type BrandProps,
  type ClipEditProps,
  type SlideProps,
  type VerseReelProps,
} from "./types";

const brand: BrandProps = {
  signatureText: "@tanishka.guduru",
  handle: "@tanishka.guduru",
  position: "bottom-center",
  opacity: 0.85,
  accent: "#F4C77B",
  outro: { enabled: true, text: "Follow for daily encouragement", seconds: 2 },
};

const verseDefaults: VerseReelProps = {
  preset: "dawn",
  language: "english",
  hook: "When you feel like giving up, read this.",
  verseText:
    "Don't be afraid, for I am with you. Don't be dismayed, for I am your God. I will strengthen you. Yes, I will help you.",
  reference: "Isaiah 41:10",
  emphasis: ["with", "strengthen", "help"],
  brand,
  verseSeconds: 9,
  hookSeconds: 1.8,
  seed: 3,
};

const slideDefaults: SlideProps = {
  preset: "paper",
  language: "english",
  kind: "cover",
  index: 0,
  total: 5,
  title: "Stillness isn't weakness",
  body: "Sometimes the bravest thing you can do is be still and let God fight for you.",
  reference: "Exodus 14:14",
  brand,
  seed: 4,
};

const clipDefaults: ClipEditProps = {
  segments: [],
  transition: "fade",
  captions: { words: [], style: "karaoke", language: "english" },
  brand,
  keepAudio: true,
  preset: "night",
};

const backdropDefaults: BackdropProps = { light: "beams", palette: "royal" };

export const Root: React.FC = () => (
  <>
    <Composition
      id="Backdrop"
      component={Backdrop}
      fps={FPS}
      width={REEL.width}
      height={REEL.height}
      durationInFrames={240}
      defaultProps={backdropDefaults}
      calculateMetadata={({ props }) => FORMAT_SIZE[props.format ?? "reel"]}
    />
    <Still
      id="BackdropStill"
      component={Backdrop}
      width={REEL.width}
      height={REEL.height}
      defaultProps={backdropDefaults}
      calculateMetadata={({ props }) => FORMAT_SIZE[props.format ?? "reel"]}
    />
    <Composition
      id="VerseReel"
      component={VerseReel}
      fps={FPS}
      width={REEL.width}
      height={REEL.height}
      durationInFrames={verseReelFrames(verseDefaults)}
      defaultProps={verseDefaults}
      calculateMetadata={({ props }) => ({ durationInFrames: verseReelFrames(props), ...FORMAT_SIZE[props.format ?? "reel"] })}
    />
    <Still id="Slide" component={Slide} width={SLIDE.width} height={SLIDE.height} defaultProps={slideDefaults} />
    <Composition
      id="ClipEdit"
      component={ClipEdit}
      fps={FPS}
      width={REEL.width}
      height={REEL.height}
      durationInFrames={FPS * 5}
      defaultProps={clipDefaults}
      calculateMetadata={({ props }) => ({ durationInFrames: clipEditFrames(props), ...FORMAT_SIZE[props.format ?? "reel"] })}
    />
  </>
);
