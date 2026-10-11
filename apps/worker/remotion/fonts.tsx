// Fonts are bundled from npm (@fontsource) so renders never depend on the network.
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/playfair-display/500.css";
import "@fontsource/playfair-display/500-italic.css";
import "@fontsource/caveat/600.css";
import "@fontsource/noto-serif-telugu/500.css";
import "@fontsource/noto-serif-telugu/700.css";
import "@fontsource/noto-sans-telugu/600.css";
import "@fontsource/noto-sans-telugu/800.css";
import React, { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

export const FONTS = {
  serif: "'Cormorant Garamond', 'Noto Serif Telugu', Georgia, serif",
  display: "'Playfair Display', 'Noto Serif Telugu', Georgia, serif",
  sans: "Inter, 'Noto Sans Telugu', system-ui, sans-serif",
  bold: "Montserrat, 'Noto Sans Telugu', Inter, sans-serif",
  hand: "Caveat, 'Noto Sans Telugu', cursive",
  teluguSerif: "'Noto Serif Telugu', serif",
  teluguSans: "'Noto Sans Telugu', sans-serif",
};

const LOAD = [
  "500 40px 'Cormorant Garamond'",
  "italic 500 40px 'Cormorant Garamond'",
  "600 40px 'Cormorant Garamond'",
  "400 40px Inter",
  "600 40px Inter",
  "800 40px Montserrat",
  "500 40px 'Playfair Display'",
  "italic 500 40px 'Playfair Display'",
  "600 40px Caveat",
  "500 40px 'Noto Serif Telugu'",
  "700 40px 'Noto Serif Telugu'",
  "600 40px 'Noto Sans Telugu'",
  "800 40px 'Noto Sans Telugu'",
];

// Holds the frame until every font face has loaded.
export const FontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all(LOAD.map((f) => document.fonts.load(f, "Aa తె")))
      .catch(() => undefined)
      .then(() => document.fonts.ready)
      .finally(() => continueRender(handle));
  }, [handle]);
  return <>{children}</>;
};
