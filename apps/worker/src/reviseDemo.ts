// npm run demo -w apps/worker, then: tsx src/reviseDemo.ts <demo folder>
// Queues a revision of every finished output, adds feedback, and runs the worker once.
import fs from "node:fs";
import path from "node:path";
import { newJobId, type Job } from "../../../shared/schema";
import { Engine } from "./engine";
import { LocalStore } from "./store";

const root = path.resolve(process.argv[2]);
const store = new LocalStore(root);
(async () => {
  await store.init();
  const { mock } = await import("./demo");
  const jobs = (await store.listJobs()).filter((j) => j.job.status === "done" && j.job.request.type !== "revise");
  const ts = new Date().toISOString();
  for (const { job } of jobs) {
    for (const o of job.outputs.slice(0, 1)) {
      if (!o.specFileId) continue;
      const request =
        o.source === "verse"
          ? { type: "revise" as const, sourceJobId: job.id, sourceTitle: o.title, specFileId: o.specFileId, changes: {}, instruction: "Make the hook a question and slow it down", remember: true }
          : o.source === "edit"
            ? { type: "revise" as const, sourceJobId: job.id, sourceTitle: o.title, specFileId: o.specFileId, changes: { hook: "Sunday praise 🙌", captions: "off" as const, speed: "faster" as const }, instruction: "", remember: false }
            : { type: "revise" as const, sourceJobId: job.id, sourceTitle: o.title, specFileId: o.specFileId, changes: { slides: [{ title: "You can rest now", body: "Swipe for a reminder." }], preset: "night" as const }, instruction: "", remember: false };
      const j: Job = { id: newJobId(), status: "queued", source: "manual", createdAt: ts, updatedAt: ts, request, stage: "", progress: 0, outputs: [], log: [], attempts: 0 };
      await store.saveJob(j);
      fs.writeFileSync(
        path.join(root, "Feedback", `${job.id}.json`),
        JSON.stringify({ id: job.id, createdAt: ts, jobId: job.id, outputKey: `${job.id}:${o.coverFileId}`, title: o.title, source: o.source, preset: "dawn", rating: 3, tags: ["Hook is weak"], note: "Hooks should be questions", remember: true }),
      );
    }
  }
  await new Engine(store, mock).start({ once: true });
  for (const { job } of await store.listJobs()) {
    if (job.request.type !== "revise") continue;
    const o = job.outputs[0];
    console.log(`revise ${job.status} ${job.error ?? ""} -> v${o?.version} "${o?.changeNote}" ${[...(o?.variants ?? []).map((v) => v.fileId), ...(o?.slideFileIds ?? [])].join(", ")}`);
  }
  console.log("LEARNED:\n" + (await store.readLearned()));
  process.exit(0);
})();
