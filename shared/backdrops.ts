// The built-in "worship studio" backdrop catalogue: every lighting setup in every
// palette. Shared by the website (picker with previews) and the renderer.
export const BACKDROP_LIGHTS = [
  { id: "beams", label: "Stage beams", group: "stage" },
  { id: "spotlight", label: "Spotlight", group: "stage" },
  { id: "bokeh", label: "Bokeh lights", group: "stage" },
  { id: "ledwall", label: "LED wall", group: "stage" },
  { id: "haze", label: "Haze glow", group: "stage" },
  { id: "cross", label: "Glowing cross", group: "stage" },
  { id: "candles", label: "Candles", group: "stage" },
  { id: "clouds", label: "Heavenly clouds", group: "stage" },
  { id: "window", label: "Stained glass", group: "stage" },
  { id: "truss", label: "Concert truss", group: "stage" },
  { id: "curtain", label: "Stage curtain", group: "stage" },
  { id: "dawn", label: "Sunrise", group: "stage" },
] as const;

// Colours are 6-digit hex (the renderer appends alpha).
export const BACKDROP_PALETTES = [
  { id: "royal", label: "Royal purple", bg1: "#2a1450", bg2: "#08030f", light: "#b98cff", accent: "#f2c46b", bright: false },
  { id: "ocean", label: "Deep blue", bg1: "#0b2a5c", bg2: "#02060f", light: "#5cb8ff", accent: "#9be7ff", bright: false },
  { id: "gold", label: "Warm gold", bg1: "#4a2c0b", bg2: "#0d0702", light: "#ffc66b", accent: "#ffe4a8", bright: false },
  { id: "crimson", label: "Crimson", bg1: "#4d0b18", bg2: "#0d0204", light: "#ff5a6e", accent: "#ffb36b", bright: false },
  { id: "emerald", label: "Emerald", bg1: "#0b4030", bg2: "#020d09", light: "#4fe0a5", accent: "#c8ff9b", bright: false },
  { id: "teal", label: "Teal", bg1: "#08414a", bg2: "#020c0e", light: "#3fe0e0", accent: "#ffd27a", bright: false },
  { id: "rose", label: "Rose", bg1: "#4a1036", bg2: "#0e030a", light: "#ff7ac4", accent: "#ffc2e2", bright: false },
  { id: "sunset", label: "Sunset", bg1: "#5a1f2a", bg2: "#12050a", light: "#ff8a4a", accent: "#ff4f8b", bright: false },
  { id: "midnight", label: "Midnight", bg1: "#101a3a", bg2: "#02030a", light: "#e6ecff", accent: "#7f9cff", bright: false },
  { id: "white", label: "White studio", bg1: "#f4f1ec", bg2: "#cfc9c0", light: "#ffffff", accent: "#ffe2b8", bright: true },
  { id: "charcoal", label: "Charcoal", bg1: "#2b2b2e", bg2: "#08080a", light: "#f0f0f0", accent: "#bdbdbd", bright: false },
  { id: "lavender", label: "Lavender", bg1: "#3d3266", bg2: "#0d0a1a", light: "#d6c8ff", accent: "#ffd6f0", bright: false },
  { id: "amber", label: "Amber", bg1: "#4a3008", bg2: "#0e0902", light: "#ffb23f", accent: "#ff7a3f", bright: false },
  { id: "forest", label: "Forest", bg1: "#1d3315", bg2: "#050a04", light: "#a8e06b", accent: "#ffe08a", bright: false },
  { id: "ice", label: "Ice", bg1: "#1b3a4d", bg2: "#050b10", light: "#cdeeff", accent: "#ffffff", bright: false },
] as const;

export type BackdropLight = (typeof BACKDROP_LIGHTS)[number]["id"];
export type BackdropPalette = (typeof BACKDROP_PALETTES)[number]["id"];

export interface BackdropPreset {
  id: string; // "<light>-<palette>"
  light: BackdropLight;
  palette: BackdropPalette;
  label: string;
  group: "room" | "stage";
}

export const BACKDROP_PRESETS: BackdropPreset[] = BACKDROP_LIGHTS.flatMap((l) =>
  BACKDROP_PALETTES.map((p) => ({ id: `${l.id}-${p.id}`, light: l.id, palette: p.id, label: `${l.label} · ${p.label}`, group: l.group })),
);

export function backdropById(id: string): BackdropPreset | undefined {
  return BACKDROP_PRESETS.find((b) => b.id === id);
}

// Ideas for the free stock library search (Pixabay), shown as one-tap chips.
// Real photo/video backgrounds from Pixabay (free for commercial use), in curated
// categories. Each loads in the orientation of the video being made.
export interface StockCategory {
  id: string;
  label: string;
  query: string;
  kind: "photo" | "video";
  group: "studio" | "church" | "devotional" | "nature" | "seasonal";
}
export const STOCK_CATEGORIES: StockCategory[] = [
  { id: "home-studio", label: "Home studio", query: "home studio interior empty", kind: "photo", group: "studio" },
  { id: "living-room", label: "Cosy living room", query: "cozy living room interior", kind: "photo", group: "studio" },
  { id: "bookshelf", label: "Bookshelf", query: "bookshelf library interior", kind: "photo", group: "studio" },
  { id: "cafe", label: "Café", query: "cafe interior lights", kind: "photo", group: "studio" },
  { id: "office", label: "Modern office", query: "modern office interior empty", kind: "photo", group: "studio" },
  { id: "neon", label: "Neon / RGB room", query: "neon lights room", kind: "photo", group: "studio" },
  { id: "wood-wall", label: "Wood wall & lamp", query: "wooden wall lamp interior", kind: "photo", group: "studio" },
  { id: "plants", label: "Plants & window light", query: "window light plants interior", kind: "photo", group: "studio" },
  { id: "bokeh", label: "Bokeh lights", query: "bokeh lights background", kind: "photo", group: "studio" },
  { id: "bokeh-video", label: "Bokeh lights (moving)", query: "bokeh lights", kind: "video", group: "studio" },
  { id: "church", label: "Church interior", query: "church interior", kind: "photo", group: "church" },
  { id: "chapel", label: "Chapel & cathedral", query: "cathedral interior light", kind: "photo", group: "church" },
  { id: "stage", label: "Worship stage", query: "concert stage lights", kind: "photo", group: "church" },
  { id: "stage-video", label: "Stage lights (moving)", query: "stage lights", kind: "video", group: "church" },
  { id: "church-video", label: "Church (moving)", query: "church interior", kind: "video", group: "church" },
  { id: "stained-glass", label: "Stained glass", query: "stained glass window church", kind: "photo", group: "church" },
  { id: "candles", label: "Candles", query: "candles light dark", kind: "photo", group: "devotional" },
  { id: "candles-video", label: "Candles (moving)", query: "candle flame", kind: "video", group: "devotional" },
  { id: "cross", label: "Cross & light", query: "cross light", kind: "photo", group: "devotional" },
  { id: "bible", label: "Open Bible", query: "bible open light", kind: "photo", group: "devotional" },
  { id: "worship-hands", label: "Worship & hands raised", query: "worship hands raised", kind: "photo", group: "devotional" },
  { id: "light-rays", label: "Light rays", query: "sun rays light", kind: "photo", group: "devotional" },
  { id: "sunrise", label: "Sunrise", query: "sunrise landscape", kind: "photo", group: "nature" },
  { id: "clouds", label: "Clouds & sky", query: "clouds sky heaven", kind: "photo", group: "nature" },
  { id: "clouds-video", label: "Clouds (moving)", query: "clouds timelapse", kind: "video", group: "nature" },
  { id: "mountains", label: "Mountains", query: "mountains landscape", kind: "photo", group: "nature" },
  { id: "ocean", label: "Ocean", query: "ocean calm", kind: "photo", group: "nature" },
  { id: "forest", label: "Forest light", query: "forest sunlight", kind: "photo", group: "nature" },
  { id: "christmas", label: "Christmas", query: "christmas lights interior", kind: "photo", group: "seasonal" },
  { id: "easter", label: "Easter", query: "easter cross sunrise", kind: "photo", group: "seasonal" },
];
