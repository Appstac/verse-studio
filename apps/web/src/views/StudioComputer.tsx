// Settings > Studio computer: live heartbeat details plus the on/off switches.
// Switches act right away (they don't wait for "Save changes"): they write
// State/control.json, and the worker confirms by echoing the request time in its heartbeat.
import { useEffect, useState } from "react";
import type { WorkerControl } from "@shared/schema";
import { useApp } from "../App";
import { loadControl, sendControl, workerOnline } from "../studio";

function ago(iso?: string) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

export function StudioComputerSection() {
  const { studio, toast, refresh } = useApp();
  const w = studio.worker;
  const online = workerOnline(w);
  const [pending, setPending] = useState<WorkerControl | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    loadControl(studio.folders)
      .then(({ control }) => setPending(control))
      .catch(() => undefined);
  }, [studio.folders]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // A request is still waiting if the worker hasn't confirmed it yet.
  const waiting = !!pending && !(w?.controlAt && Date.parse(w.controlAt) >= Date.parse(pending.requestedAt));
  const autostart = waiting && pending?.autostart !== undefined ? pending.autostart : (w?.autostart ?? true);
  const paused = waiting && pending?.paused !== undefined ? pending.paused : (w?.paused ?? false);
  const manual = w?.supervisor === "manual";

  const send = async (change: Omit<WorkerControl, "requestedAt">, msg: string) => {
    setBusy(true);
    try {
      setPending(await sendControl(studio.folders, change));
      toast(msg);
      void refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  let state = "Not set up yet";
  if (w && online) state = w.paused ? "Online, paused" : w.busy ? "Online, making videos" : "Online, ready";
  else if (w) state = "Offline";

  return (
    <section className="panel stack">
      <div>
        <h2>Studio computer</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          The PC that makes the videos. It reports in every {w?.intervalSeconds ?? 20} seconds or so.
        </p>
      </div>

      <div className="kvgrid">
        <span>Status</span>
        <b>
          <span className={`dot inline ${online ? (w?.paused ? "paused" : w?.busy ? "busy" : "on") : ""}`} /> {state}
        </b>
        <span>Last heartbeat</span>
        <b>{ago(w?.lastSeen)}</b>
        {w ? (
          <>
            <span>Computer</span>
            <b>{w.hostname}</b>
            <span>Running since</span>
            <b>{w.startedAt ? new Date(w.startedAt).toLocaleString() : "unknown"}</b>
            <span>Version</span>
            <b>{w.commit ?? w.version}</b>
            <span>Claude</span>
            <b>{w.claudeOk === false ? "Problem: sign in to Claude again on the PC" : w.claudeOk ? "Connected" : "Checking…"}</b>
            {w.nextAutoRun ? (
              <>
                <span>Next auto batch</span>
                <b>{new Date(w.nextAutoRun).toLocaleString()}</b>
              </>
            ) : null}
            {w.currentJob ? (
              <>
                <span>Working on</span>
                <b>{w.currentJob}</b>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {w?.message ? <p className="notice">{w.message}</p> : null}
      {w?.lastError ? <p className="notice warn">Last problem: {w.lastError}</p> : null}
      {w?.lastUpdate ? (
        <p className={`notice ${w.lastUpdate.ok ? "" : "err"}`}>
          Last update {ago(w.lastUpdate.at)}: {w.lastUpdate.message}
        </p>
      ) : null}
      {!online && w ? (
        <p className="notice warn">
          {w.autostart === false
            ? "Autostart is off, so it won't come back by itself. On the PC, open the Verse Studio folder on the desktop and double-click “Start Verse Studio”."
            : "It should come back by itself within 5 minutes of the PC being on and signed in. If it doesn't, check the PC is awake and connected to the internet."}
        </p>
      ) : null}
      {manual ? (
        <p className="notice warn">
          This worker was started by hand, so it can't restart itself. On the PC, double-click “Set up autostart (Windows).cmd” in the verse-studio folder once.
        </p>
      ) : null}

      <label className="check">
        <input
          type="checkbox"
          checked={!paused}
          disabled={busy || !w}
          onChange={(e) =>
            send(
              { paused: !e.target.checked },
              e.target.checked ? "Resuming: the studio computer will start making videos again" : "Pausing: queued videos will wait",
            )
          }
        />
        <span>
          <b>Make videos</b>
          <br />
          <small className="hint">Turn off to pause. It stays connected and keeps reporting in, but won't start new videos or auto batches.</small>
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={autostart}
          disabled={busy || !w}
          onChange={(e) =>
            send(
              { autostart: e.target.checked },
              e.target.checked ? "Autostart on" : "Autostart off: it keeps running until the PC restarts or it's closed",
            )
          }
        />
        <span>
          <b>Start automatically and restart if closed</b>
          <br />
          <small className="hint">
            On: starts when the PC is signed in, is checked every 5 minutes, and comes back by itself if it closes or freezes.
            {w?.supervisor === "launchd" ? " (On a Mac this is always on.)" : ""}
          </small>
        </span>
      </label>

      <div className="row">
        <button className="btn small" disabled={busy || !online || manual} onClick={() => send({ action: "restart" }, "Restart requested")}>
          Restart
        </button>
        <button
          className="btn small"
          disabled={busy || !online || manual || !!w?.busy}
          title={w?.busy ? "Wait until the current video is finished" : undefined}
          onClick={() => send({ action: "update" }, "Update requested: the studio computer will download the latest version and restart")}
        >
          Update to latest version
        </button>
      </div>
      {waiting ? <p className="hint">Waiting for the studio computer to pick this up{online ? " (usually under a minute)" : " (when it's back online)"}…</p> : null}
    </section>
  );
}
