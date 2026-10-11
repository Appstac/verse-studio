import React, { useCallback, useEffect, useRef, useState } from "react";
import { MOODS, type Mood } from "@shared/schema";
import { useApp } from "../App";
import * as g from "../google";

const MOOD_LABEL: Record<Mood, string> = {
  calm: "Calm",
  uplifting: "Uplifting",
  worship: "Worship",
  reflective: "Reflective",
  christmas: "Christmas",
  easter: "Easter",
};

function Preview({ file }: { file: g.DFile }) {
  const [url, setUrl] = useState<string>();
  const audio = /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(file.name);
  const video = /\.(mp4|mov|m4v|webm)$/i.test(file.name);
  if (!url) {
    return (
      <button className="btn small" onClick={() => g.objectUrl(file.id).then(setUrl)}>
        {audio ? "Listen" : "Preview"}
      </button>
    );
  }
  if (audio) return <audio src={url} controls autoPlay style={{ height: 34 }} />;
  if (video) return <video src={url} controls autoPlay muted playsInline style={{ width: 120, borderRadius: 8 }} />;
  return <img src={url} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }} />;
}

function FolderFiles({ folderId, accept, empty, addLabel }: { folderId: string; accept: string; empty: string; addLabel: string }) {
  const { toast } = useApp();
  const [files, setFiles] = useState<g.DFile[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setFiles((await g.children(folderId, "mimeType!='application/vnd.google-apps.folder'")).reverse());
  }, [folderId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      {files === null ? (
        <p className="hint">Loading…</p>
      ) : files.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <div className="files">
          {files.map((f) => (
            <div className="filerow" key={f.id}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span className="row">
                <Preview file={f} />
                <button
                  className="btn quiet small danger"
                  onClick={async () => {
                    await g.trash(f.id);
                    toast(`Removed ${f.name}`);
                    void load();
                  }}
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn small" disabled={progress !== null} onClick={() => input.current?.click()}>
          {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : addLabel}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={accept}
          onChange={async (e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            for (const file of list) {
              setProgress(0);
              try {
                await g.uploadFile(file, folderId, setProgress);
              } catch (err) {
                toast(err instanceof Error ? err.message : "Upload failed");
              }
            }
            setProgress(null);
            void load();
          }}
        />
      </div>
    </div>
  );
}

function MoodFolders() {
  const { studio } = useApp();
  const [mood, setMood] = useState<Mood>("calm");
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    setFolder(null);
    g.ensureSubfolder(studio.folders["Music/Library"], mood).then(setFolder);
  }, [mood, studio.folders]);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="seg tight" role="group" aria-label="Mood">
        {MOODS.map((m) => (
          <button key={m} aria-pressed={mood === m} onClick={() => setMood(m)}>
            {MOOD_LABEL[m]}
          </button>
        ))}
      </div>
      {folder ? (
        <FolderFiles
          key={folder}
          folderId={folder}
          accept="audio/*"
          addLabel={`Add ${MOOD_LABEL[mood].toLowerCase()} tracks`}
          empty={`No ${MOOD_LABEL[mood].toLowerCase()} tracks yet. Reels with this mood will use a track from another mood.`}
        />
      ) : (
        <p className="hint">Loading…</p>
      )}
    </div>
  );
}

export function Library() {
  const { studio } = useApp();
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Library</h1>
          <p>Music and backgrounds the studio uses. Everything here is stored in your Google Drive.</p>
        </div>
      </div>
      <div className="stack" style={{ gap: 22 }}>
        <section className="panel stack">
          <div>
            <h2>Library music</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              Used for the “Library music” version of every reel, matched by mood. Only add tracks you're allowed to use, such as
              Pixabay Music or the YouTube Audio Library. The soft “starter” pads are placeholders you can remove once you've added real tracks.
            </p>
          </div>
          <MoodFolders />
        </section>
        <section className="panel stack">
          <div>
            <h2>My music</h2>
            <p className="muted" style={{ marginTop: 6 }}>Your own recordings, for example worship on the keyboard. Used for the “My music” version.</p>
          </div>
          <FolderFiles folderId={studio.folders["Music/Mine"]} accept="audio/*" addLabel="Add my recordings" empty="Nothing yet. Add a recording to get a “My music” version of each reel." />
        </section>
        <section className="panel stack">
          <div>
            <h2>Backgrounds</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              Photos and short clips (sky, church, candles, nature) for the “My backgrounds” look. Vertical clips of 5 to 20 seconds work best.
            </p>
          </div>
          <FolderFiles folderId={studio.folders.Backgrounds} accept="video/*,image/*" addLabel="Add backgrounds" empty="No backgrounds yet." />
        </section>
      </div>
    </>
  );
}
