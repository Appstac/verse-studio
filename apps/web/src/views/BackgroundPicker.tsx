// Virtual green screen background picker: none, room blur, real stock photos/videos
// (free Pixabay search, curated categories), animated light effects, your own pictures,
// or a plain colour. Shows what each option looks like before you send the video.
import { useEffect, useState } from "react";
import { BACKDROP_LIGHTS, BACKDROP_PALETTES, STOCK_CATEGORIES } from "@shared/backdrops";
import type { BackgroundChoice, VideoFormat } from "@shared/schema";
import { useApp } from "../App";
import * as g from "../google";

type Hit = { id: number; thumb: string; kind: "photo" | "video"; user?: string };
type Tab = "none" | "blur" | "stock" | "studio" | "mine" | "color";

async function searchPixabay(key: string, kind: "photo" | "video", q: string, format: VideoFormat, page: number): Promise<{ hits: Hit[]; total: number }> {
  const orientation = format === "youtube" ? "horizontal" : "vertical";
  const base = kind === "video" ? "https://pixabay.com/api/videos/" : "https://pixabay.com/api/";
  const p = new URLSearchParams({ key, q, safesearch: "true", per_page: "30", page: String(page) });
  if (kind === "photo") {
    p.set("image_type", "photo");
    p.set("orientation", orientation);
  }
  const r = await fetch(`${base}?${p}`);
  if (r.status === 400) throw new Error("Pixabay didn't accept the key. Check it in Settings → Advanced.");
  if (!r.ok) throw new Error(`Pixabay returned ${r.status}`);
  const j = (await r.json()) as { totalHits: number; hits: Array<Record<string, any>> };
  return {
    total: j.totalHits,
    hits: j.hits.map((h) => ({
      id: h.id,
      kind,
      user: h.user,
      thumb: kind === "photo" ? h.webformatURL : h.videos?.tiny?.thumbnail || h.videos?.small?.thumbnail || `https://i.vimeocdn.com/video/${h.picture_id}_295x166.jpg`,
    })),
  };
}

export function BackgroundPicker({ value, onChange, format }: { value: BackgroundChoice; onChange: (b: BackgroundChoice) => void; format: VideoFormat }) {
  const { studio } = useApp();
  const key = studio.settings.advanced.pixabayKey;
  const [tab, setTab] = useState<Tab>(value.mode === "none" ? "none" : (value.mode as Tab));
  const [cat, setCat] = useState(STOCK_CATEGORIES[0].id);
  const [query, setQuery] = useState(STOCK_CATEGORIES[0].query);
  const [kind, setKind] = useState<"photo" | "video">(STOCK_CATEGORIES[0].kind);
  const [hits, setHits] = useState<Hit[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<g.DFile[] | null>(null);
  const [mineThumbs, setMineThumbs] = useState<Record<string, string>>({});
  const [light, setLight] = useState(value.preset.split("-")[0] || "beams");

  const set = (p: Partial<BackgroundChoice>) => onChange({ ...value, ...p });

  useEffect(() => {
    if (tab !== "stock" || !key) return;
    let live = true;
    setBusy(true);
    setErr(null);
    searchPixabay(key, kind, query, format, page)
      .then((r) => {
        if (!live) return;
        setHits((h) => (page === 1 ? r.hits : [...h, ...r.hits]));
        setTotal(r.total);
      })
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [tab, key, kind, query, format, page]);

  useEffect(() => {
    if (tab !== "mine" || mine) return;
    g.children(studio.folders.Backgrounds, "mimeType!='application/vnd.google-apps.folder'")
      .then((f) => {
        setMine(f);
        for (const file of f.filter((x) => x.mimeType.startsWith("image/")).slice(0, 40)) {
          g.objectUrl(file.id)
            .then((u) => setMineThumbs((t) => ({ ...t, [file.id]: u })))
            .catch(() => undefined);
        }
      })
      .catch(() => setMine([]));
  }, [tab, mine, studio.folders.Backgrounds]);

  const pickTab = (t: Tab) => {
    setTab(t);
    if (t === "none" || t === "blur" || t === "color") set({ mode: t });
  };

  return (
    <div className="stack">
      <div className="seg" role="group" aria-label="Background">
        {(
          [
            ["none", "Keep the real room"],
            ["blur", "Blur the room"],
            ["stock", "Real photos & videos"],
            ["studio", "Light effects"],
            ["mine", "My backgrounds"],
            ["color", "Plain colour"],
          ] as Array<[Tab, string]>
        ).map(([t, l]) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => pickTab(t)}>
            {l}
          </button>
        ))}
      </div>

      {tab === "none" ? <p className="hint">The original background stays. Studio lighting (if on) still lifts the speaker from the room.</p> : null}
      {tab === "blur" ? <p className="hint">The speaker stays sharp and the room behind them goes soft, like a portrait-mode camera.</p> : null}

      {tab === "stock" ? (
        !key ? (
          <p className="notice warn">
            Real photo and video backgrounds come from Pixabay (free, allowed for commercial use). Get a free key at pixabay.com/api/docs, then paste it in Settings → Advanced.
          </p>
        ) : (
          <div className="stack">
            <div className="chips">
              {STOCK_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${cat === c.id ? "on" : ""}`}
                  onClick={() => {
                    setCat(c.id);
                    setQuery(c.query);
                    setKind(c.kind);
                    setPage(1);
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="row">
              <input
                type="search"
                defaultValue={query}
                key={query}
                placeholder="Search, e.g. cozy studio lamp"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setCat("");
                    setQuery((e.target as HTMLInputElement).value || "studio background");
                    setPage(1);
                  }
                }}
              />
              <div className="seg tight" role="group" aria-label="Photo or video">
                {(["photo", "video"] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => (setKind(k), setPage(1))}>
                    {k === "photo" ? "Photos" : "Moving"}
                  </button>
                ))}
              </div>
            </div>
            {err ? <p className="notice err">{err}</p> : null}
            <div className={`bg-grid ${format === "youtube" ? "wide" : ""}`}>
              {hits.map((h) => {
                const on = value.mode === "stock" && value.stockId === h.id;
                return (
                  <button key={`${h.kind}${h.id}`} type="button" className={`bg-tile ${on ? "on" : ""}`} onClick={() => set({ mode: "stock", stockId: h.id, stockKind: h.kind, stockThumb: h.thumb })}>
                    <img src={h.thumb} alt="" loading="lazy" style={{ filter: value.depthBlur ? "blur(1.5px)" : undefined }} />
                    {h.kind === "video" ? <span className="bg-badge">moving</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="row">
              {hits.length < total ? (
                <button type="button" className="btn small" disabled={busy} onClick={() => setPage((p) => p + 1)}>
                  {busy ? "Loading…" : `Load more (${total - hits.length} more)`}
                </button>
              ) : busy ? (
                <span className="hint">Loading…</span>
              ) : null}
              <small className="hint">Images from Pixabay.</small>
            </div>
          </div>
        )
      ) : null}

      {tab === "studio" ? (
        <div className="stack">
          <div className="chips">
            {BACKDROP_LIGHTS.map((l) => (
              <button key={l.id} type="button" className={`chip ${light === l.id ? "on" : ""}`} onClick={() => setLight(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="bg-grid">
            {BACKDROP_PALETTES.map((p) => {
              const id = `${light}-${p.id}`;
              const on = value.mode === "studio" && value.preset === id;
              return (
                <button key={id} type="button" className={`bg-tile ${on ? "on" : ""}`} onClick={() => set({ mode: "studio", preset: id })} title={p.label}>
                  <img src={`/backdrops/${id}.jpg`} alt={p.label} loading="lazy" />
                  <span className="bg-badge">{p.label}</span>
                </button>
              );
            })}
          </div>
          <small className="hint">Animated stage lighting (it moves gently in the video).</small>
        </div>
      ) : null}

      {tab === "mine" ? (
        mine === null ? (
          <p className="hint">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="hint">No backgrounds yet. Add photos or videos under Library → Backgrounds.</p>
        ) : (
          <div className={`bg-grid ${format === "youtube" ? "wide" : ""}`}>
            {mine.map((f) => {
              const on = value.mode === "mine" && value.mineFileId === f.id;
              return (
                <button key={f.id} type="button" className={`bg-tile ${on ? "on" : ""}`} onClick={() => set({ mode: "mine", mineFileId: f.id, mineName: f.name })}>
                  {mineThumbs[f.id] ? <img src={mineThumbs[f.id]} alt="" /> : <span className="bg-badge">{f.name}</span>}
                </button>
              );
            })}
          </div>
        )
      ) : null}

      {tab === "color" ? (
        <label className="field">
          <span>Colour</span>
          <input type="color" value={value.color} onChange={(e) => set({ mode: "color", color: e.target.value })} className="swatch-input" />
        </label>
      ) : null}

      {tab === "stock" || tab === "mine" ? (
        <label className="check">
          <input type="checkbox" checked={value.depthBlur} onChange={(e) => set({ depthBlur: e.target.checked })} />
          <span>
            Soft camera blur on the background
            <br />
            <small className="hint">Makes any photo read as a real out-of-focus room behind the speaker.</small>
          </span>
        </label>
      ) : null}
    </div>
  );
}
