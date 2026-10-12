// Renders preview pictures of every built-in backdrop for the website picker.
import fs from "node:fs";
import path from "node:path";
import { BACKDROP_PRESETS } from "../../../shared/backdrops";
import { renderBackdropStill } from "./render";
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const only = process.argv[3];
const format = (process.argv[4] as "reel" | "youtube") || "reel";
let n = 0;
for (const b of BACKDROP_PRESETS) {
  if (only && only !== "all" && !b.id.includes(only)) continue;
  const f = path.join(out, format === "reel" ? `${b.id}.jpg` : `${b.id}-wide.jpg`);
  if (fs.existsSync(f)) continue;
  await renderBackdropStill(b.light, b.palette, f, 70, format);
  n++;
}
console.log("rendered", n);
process.exit(0);
