import React, { useEffect, useState } from "react";
import type { AudioVariant, Job, OutputItem } from "@shared/schema";
import { useApp } from "../App";
import { ReviewTools } from "./Review";
import * as g from "../google";
import { cancelJob, queueJob, removeJob, setJobStatus, workerOnline, type JobEntry } from "../studio";

const VARIANT_LABEL: Record<AudioVariant, string> = {
  original: "Original sound",
  library: "Library music",
  mine: "My music",
  silent: "No music",
};

function describe(job: Job) {
  const r = job.request;
  if (r.type === "revise") return `New version of “${r.sourceTitle || "a reel"}”${r.instruction ? `: “${r.instruction.slice(0, 60)}${r.instruction.length > 60 ? "…" : ""}”` : ""}`;
  if (r.type === "learn") return "Learning from your feedback";
  if (r.type === "verse") return `${r.count} verse reel${r.count > 1 ? "s" : ""}${r.theme ? `: ${r.theme}` : ""}`;
  if (r.type === "carousel") return `Carousel${r.topic ? `: ${r.topic}` : ""}`;
  return `Edit of ${r.inputFileIds.length} upload${r.inputFileIds.length > 1 ? "s" : ""}${r.prompt ? `: “${r.prompt.slice(0, 60)}${r.prompt.length > 60 ? "…" : ""}”` : ""}`;
}

function useObjectUrl(id?: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    if (id) g.objectUrl(id).then((u) => live && setUrl(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

async function copyCaption(o: OutputItem, toast: (m: string) => void) {
  const text = `${o.caption}\n\n${o.hashtags.join(" ")}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Caption copied");
  } catch {
    toast("Couldn't copy. Long-press the caption to copy it instead.");
  }
}

function ReelCard({ o, auto, job }: { o: OutputItem; auto: boolean; job: Job }) {
  const { toast } = useApp();
  const [variant, setVariant] = useState<AudioVariant>(o.variants[0]?.label ?? "silent");
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const cover = useObjectUrl(o.coverFileId);
  const current = o.variants.find((v) => v.label === variant) ?? o.variants[0];
  const video = useObjectUrl(playing ? current?.fileId : undefined);

  return (
    <article className={`reel ${o.format === "youtube" ? "wide" : ""}`}>
      <div className={`phone ${o.format === "youtube" ? "wide" : ""}`}>
        {playing && video ? (
          <video key={video} src={video} controls autoPlay playsInline poster={cover} />
        ) : (
          <>
            {cover ? <img src={cover} alt="" /> : null}
            <button className="play" aria-label={`Play ${o.title}`} onClick={() => setPlaying(true)}>
              <span>
                {playing ? (
                  "…"
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
                    <path d="M8 5v14l11-7z" fill="#2a1f2d" />
                  </svg>
                )}
              </span>
            </button>
          </>
        )}
        {o.needsReview ? <span className="badge">Check text</span> : auto ? <span className="badge" style={{ background: "#fff" }}>Auto</span> : null}
      </div>
      <h3>
        {o.title}
        {o.version > 1 ? <span className="pill" style={{ marginLeft: 8, verticalAlign: "middle" }}>v{o.version}</span> : null}
      </h3>
      {o.changeNote ? <p className="hint" style={{ marginTop: -8 }}>Changed: {o.changeNote}</p> : null}
      {o.reference ? <p className="muted" style={{ fontSize: 14, marginTop: -8 }}>{o.reference}</p> : null}
      {o.needsReview && o.reviewNote ? <p className="notice warn" style={{ fontSize: 14 }}>{o.reviewNote}</p> : null}
      {o.variants.length > 1 ? (
        <div className="seg tight" role="group" aria-label="Sound">
          {o.variants.map((v) => (
            <button key={v.label} aria-pressed={variant === v.label} onClick={() => setVariant(v.label)}>
              {VARIANT_LABEL[v.label]}
            </button>
          ))}
        </div>
      ) : null}
      <p className="caption">{o.caption}</p>
      <div className="row">
        <button
          className="btn small primary"
          disabled={busy || !current}
          onClick={async () => {
            setBusy(true);
            try {
              await g.downloadFile(current!.fileId, current!.name);
            } catch (e) {
              toast(e instanceof Error ? e.message : "Download failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Downloading…" : "Download"}
        </button>
        <button className="btn small" onClick={() => void copyCaption(o, toast)}>
          Copy caption
        </button>
      </div>
      <ReviewTools job={job} o={o} />
    </article>
  );
}

function SlideImg({ id }: { id: string }) {
  const url = useObjectUrl(id);
  return <div className="phone slide">{url ? <img src={url} alt="" /> : null}</div>;
}

function CarouselCard({ o, job }: { o: OutputItem; job: Job }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <article className="reel">
      <div className="slides">
        {o.slideFileIds.map((id) => (
          <SlideImg key={id} id={id} />
        ))}
      </div>
      <h3>{o.title}</h3>
      {o.needsReview && o.reviewNote ? <p className="notice warn" style={{ fontSize: 14 }}>{o.reviewNote}</p> : null}
      <p className="caption">{o.caption}</p>
      <div className="row">
        <button
          className="btn small primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              for (let i = 0; i < o.slideFileIds.length; i++) {
                await g.downloadFile(o.slideFileIds[i], `${o.title.replace(/[^\w\s-]/g, "").trim() || "slide"}-${i + 1}.png`);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Downloading…" : `Download ${o.slideFileIds.length} slides`}
        </button>
        <button className="btn small" onClick={() => void copyCaption(o, toast)}>
          Copy caption
        </button>
      </div>
      <ReviewTools job={job} o={o} />
    </article>
  );
}

function JobRow({ e }: { e: JobEntry }) {
  const { studio, refresh, toast } = useApp();
  const j = e.job;
  const pct = Math.round(j.progress * 100);
  const failed = j.status === "failed";
  return (
    <div className="job">
      <div>
        <div className="what">{describe(j)}</div>
        <div className="stage">
          {failed ? j.error : j.status === "queued" ? (workerOnline(studio.worker) ? "Starting soon" : "Waiting for the studio computer to come online") : j.stage}
        </div>
      </div>
      <div className="row">
        {failed ? (
          <>
            <button
              className="btn small"
              onClick={async () => {
                await queueJob(studio.folders, j.request);
                await removeJob(e);
                toast("Queued again");
                void refresh();
              }}
            >
              Try again
            </button>
            <button
              className="btn small quiet"
              onClick={async () => {
                await removeJob(e);
                void refresh();
              }}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <span className="pill">{j.status === "queued" ? "In line" : `${pct}%`}</span>
            <button
              className="btn small quiet danger"
              onClick={async () => {
                await cancelJob(studio.folders, e);
                toast("Cancelling");
                void refresh();
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {!failed ? (
        <div className="bar" aria-hidden>
          <i style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function Today() {
  const { studio, refresh, go, toast } = useApp();
  const [limit, setLimit] = useState(12);
  const active = studio.jobs.filter((e) => e.job.status === "queued" || e.job.status === "working");
  const failed = studio.jobs.filter((e) => e.job.status === "failed").slice(0, 5);
  const review = studio.jobs.filter((e) => e.job.status === "review");
  const done = studio.jobs.filter((e) => e.job.status === "done" || e.job.status === "review" || (e.job.status === "working" && e.job.outputs.length));
  const items = done.flatMap((e) => e.job.outputs.map((o) => ({ o, job: e.job, auto: e.job.source === "auto", key: `${e.job.id}-${o.title}-${o.coverFileId}` })));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Your reels</h1>
          <p>Finished videos from the studio computer. Pick a sound version, download, and post.</p>
        </div>
        <button className="btn gold" onClick={() => go("make")}>
          Make something new
        </button>
      </div>

      {!studio.worker ? (
        <p className="notice warn" style={{ marginBottom: 20 }}>
          The studio computer hasn't connected yet. Finish the worker setup on the Windows PC (docs/SETUP.md, steps 4 to 6), then double-click “Set up autostart (Windows).cmd” once so it starts by itself. Anything you queue now will be made once it's online.
        </p>
      ) : null}

      {review.length ? (
        <div className="panel stack" style={{ marginBottom: 22 }}>
          <div className="row spread">
            <div>
              <h2>Waiting for your OK</h2>
              <p className="muted">Auto mode made {review.reduce((a, e) => a + e.job.outputs.length, 0)} new item(s). Watch them below, then approve.</p>
            </div>
            <button
              className="btn primary"
              onClick={async () => {
                for (const e of review) await setJobStatus(e, "done", "Approved");
                toast("Approved");
                void refresh();
              }}
            >
              Approve all
            </button>
          </div>
        </div>
      ) : null}

      {active.length || failed.length ? (
        <>
          <div className="section-title">
            <h2>In progress</h2>
          </div>
          <div className="joblist">
            {[...active, ...failed].map((e) => (
              <JobRow key={e.fileId} e={e} />
            ))}
          </div>
        </>
      ) : null}

      <div className="section-title">
        <h2>Ready to post</h2>
        <button className="btn quiet small" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {items.length === 0 ? (
        <div className="panel stack">
          <p>Nothing here yet. Make your first verse reel or upload some clips to edit.</p>
          <div>
            <button className="btn primary" onClick={() => go("make")}>
              Make a reel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="reels">
            {items.slice(0, limit).map(({ o, job, auto, key }) => (o.kind === "carousel" ? <CarouselCard key={key} o={o} job={job} /> : <ReelCard key={key} o={o} auto={auto} job={job} />))}
          </div>
          {items.length > limit ? (
            <div style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setLimit(limit + 12)}>
                Show more
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
