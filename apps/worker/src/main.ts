import { askClaude, claudeHealth } from "./claude";
import { fetchVerse } from "./bible";
import { Engine } from "./engine";
import type { Planner } from "./jobs";
import { log } from "./log";
import { DriveStore } from "./store";
import { transcribeWav } from "./whisper";

const planner: Planner = {
  plan: (_kind, prompt, schema, opts) => askClaude(prompt, schema, opts),
  verse: fetchVerse,
  transcribe: transcribeWav,
};

async function main() {
  const engine = new Engine(new DriveStore(), planner);
  claudeHealth().then((h) => {
    engine.setClaudeOk(h.ok);
    log(h.ok ? "Claude Code: OK" : `Claude Code problem: ${h.message}`);
  });
  await engine.start();
}

process.on("unhandledRejection", (e) => log("Unhandled:", e instanceof Error ? e.message : String(e)));
main().catch((e) => {
  log("Worker stopped:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
