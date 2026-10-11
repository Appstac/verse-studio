// npm run doctor: checks everything the worker needs, in plain language.
import { claudeBinary, claudeHealth } from "./claude";
import { loadCredentials, loadToken } from "./config";
import { ensureFolders } from "./drive";
import { FFMPEG, FFPROBE, run } from "./media";

const ok = (m: string) => console.log(`  ✔ ${m}`);
const bad = (m: string) => console.log(`  ✘ ${m}`);

async function main() {
  console.log("\nVerse Studio check-up\n");
  let failures = 0;

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) ok(`Node.js ${process.versions.node}`);
  else (bad(`Node.js ${process.versions.node}: version 20 or newer is needed`), failures++);

  try {
    await run(FFMPEG, ["-version"]);
    await run(FFPROBE, ["-version"]);
    ok("ffmpeg and ffprobe");
  } catch (e) {
    bad(`ffmpeg: ${e}`);
    failures++;
  }

  try {
    loadCredentials();
    ok("Google client id/secret found");
    if (!loadToken()?.refresh_token) {
      bad('Not signed in to Google Drive yet. Run "npm run login".');
      failures++;
    } else {
      const f = await ensureFolders();
      ok(`Google Drive connected ("Verse Studio" folder ${f.root})`);
    }
  } catch (e) {
    bad(e instanceof Error ? e.message : String(e));
    failures++;
  }

  const { bin } = claudeBinary();
  console.log(`  … asking Claude Code (${bin}) a test question`);
  const h = await claudeHealth();
  if (h.ok) ok(h.message);
  else (bad(h.message), failures++);

  try {
    const r = await fetch("https://bible-api.com/john%203:16?translation=web");
    if (r.ok) ok("Bible text service reachable");
    else bad(`Bible text service returned ${r.status} (English verses will fall back to Claude and be marked for review)`);
  } catch {
    bad("Bible text service not reachable (English verses will fall back to Claude and be marked for review)");
  }

  console.log(failures ? `\n${failures} problem(s) to fix. See docs/SETUP.md.\n` : "\nAll good. Start the worker with: npm run worker\n");
  process.exit(failures ? 1 : 0);
}

main();
