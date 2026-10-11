import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as g from "./google";
import { useStudio, workerOnline, type Studio } from "./studio";
import { Library } from "./views/Library";
import { Make } from "./views/Make";
import { SettingsView } from "./views/Settings";
import { Today } from "./views/Today";
import type { Heartbeat, Settings } from "@shared/schema";

type Page = "today" | "make" | "library" | "settings";
const PAGES: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: "today", label: "Reels", icon: <Icon d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 6v6l5-3z" /> },
  { id: "make", label: "Make", icon: <Icon d="M12 5v14M5 12h14" /> },
  { id: "library", label: "Library", icon: <Icon d="M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm10-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" /> },
  { id: "settings", label: "Settings", icon: <Icon d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" /> },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const Cross = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="8" fill="var(--ink)" />
    <path d="M16 7v18M10 13h12" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

interface AppCtx {
  studio: Studio;
  refresh: () => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  toast: (m: string) => void;
  go: (p: Page) => void;
}
const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => useContext(Ctx)!;

export function WorkerStatus({ w }: { w: Heartbeat | null }) {
  const online = workerOnline(w);
  let text = "Studio computer offline";
  if (!w) text = "Studio computer not set up yet";
  else if (online && w.busy) text = "Studio computer is making videos";
  else if (online) text = "Studio computer ready";
  else text = `Studio computer offline since ${new Date(w.lastSeen).toLocaleString()}`;
  return (
    <span className="status" title={w ? `${w.hostname} (${w.platform}), worker ${w.version}` : undefined}>
      <span className={`dot ${online ? (w?.busy ? "busy" : "on") : ""}`} />
      {text}
    </span>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!g.hasClientId()) {
    return (
      <div className="welcome">
        <div className="card">
          <h1>Verse Studio</h1>
          <p className="notice err">
            This site isn't connected to Google yet. Add VITE_GOOGLE_CLIENT_ID in the Vercel project settings and redeploy (docs/SETUP.md, step 3).
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="welcome">
      <div className="card">
        <Cross />
        <h1>Verse Studio</h1>
        <p className="verse">“Let the words of my mouth and the meditation of my heart be acceptable in your sight.” Psalm 19:14</p>
        <p className="muted">Sign in with the Google account that stores your Verse Studio folder. Your videos stay in your own Google Drive.</p>
        <div>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await g.signIn(true);
                const allowed = (import.meta.env.VITE_ALLOWED_EMAILS as string | undefined)?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
                if (allowed?.length) {
                  const me = await g.whoAmI();
                  if (!allowed.includes(me.email.toLowerCase())) {
                    g.signOut();
                    throw new Error(`${me.email} isn't allowed to use this studio.`);
                  }
                }
                onDone();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Signing in…" : "Sign in with Google"}
          </button>
        </div>
        {err ? <p className="notice err">{err}</p> : null}
      </div>
    </div>
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState(() => g.restoreToken());
  const [page, setPage] = useState<Page>(() => (location.hash.slice(1) as Page) || "today");
  const [msg, setMsg] = useState<string | null>(null);
  const { studio, error, refresh, saveSettings } = useStudio(signedIn);

  useEffect(() => {
    const onLost = () => setSignedIn(false);
    window.addEventListener("vs-auth-lost", onLost);
    return () => window.removeEventListener("vs-auth-lost", onLost);
  }, []);
  useEffect(() => {
    const on = () => setPage((location.hash.slice(1) as Page) || "today");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((p: Page) => {
    location.hash = p;
    setPage(p);
    window.scrollTo(0, 0);
  }, []);
  const toast = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((x) => (x === m ? null : x)), 3200);
  }, []);

  if (!signedIn) return <SignIn onDone={() => setSignedIn(true)} />;
  if (!studio) {
    return (
      <div className="welcome">
        <div className="card">
          <Cross />
          {error ? (
            <>
              <p className="notice err">{error}</p>
              <div className="row">
                <button className="btn" onClick={() => void refresh()}>
                  Try again
                </button>
                <button
                  className="btn quiet"
                  onClick={() => {
                    g.signOut();
                    setSignedIn(false);
                  }}
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Opening your studio…</p>
          )}
        </div>
      </div>
    );
  }

  const nav = (cls: string) =>
    PAGES.map((p) => (
      <button key={p.id} className="navbtn" aria-current={page === p.id ? "page" : undefined} onClick={() => go(p.id)}>
        {p.icon}
        <span>{p.label}</span>
      </button>
    ));

  return (
    <Ctx.Provider value={{ studio, refresh, saveSettings, toast, go }}>
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <div className="wordmark">
            <Cross /> Verse Studio
          </div>
          {nav("rail")}
          <div className="rail-foot">
            <WorkerStatus w={studio.worker} />
            <a href={g.driveFolderLink(studio.folders.root)} target="_blank" rel="noreferrer">
              Open the Drive folder
            </a>
            <button
              className="btn quiet small"
              style={{ justifyContent: "flex-start", padding: 0 }}
              onClick={() => {
                g.signOut();
                setSignedIn(false);
              }}
            >
              Sign out
            </button>
          </div>
        </nav>
        <main className="main">
          <div className="mobilehead">
            <div className="wordmark" style={{ padding: 0, fontSize: 20 }}>
              <Cross /> Verse Studio
            </div>
            <WorkerStatus w={studio.worker} />
          </div>
          {error ? <p className="notice err" style={{ marginBottom: 16 }}>{error}</p> : null}
          {page === "today" && <Today />}
          {page === "make" && <Make />}
          {page === "library" && <Library />}
          {page === "settings" && <SettingsView />}
        </main>
        <nav className="tabbar" aria-label="Main">
          {nav("tab")}
        </nav>
      </div>
      {msg ? (
        <div className="toast" role="status">
          {msg}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
