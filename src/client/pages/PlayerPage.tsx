import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { LaunchManifest } from "../../domain/types";
import { api } from "../api";
import { Spinner } from "../components";
import { EmulatorJsPlaybackAdapter } from "../playback/emulator-js-adapter";

type PlayerStatus = "preparing" | "loading" | "running" | "error";
type SaveStatus = "idle" | "loaded" | "syncing" | "saved" | "error";

export function PlayerPage(): React.JSX.Element {
  const { gameId = "" } = useParams();
  const adapter = useMemo(() => new EmulatorJsPlaybackAdapter(), []);
  const [manifest, setManifest] = useState<LaunchManifest | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("preparing");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [leaving, setLeaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const failed = useRef(false);
  const leavingRef = useRef(false);

  const leavePlayer = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      await adapter.save();
    } catch {
      // Leaving must remain available if capture or server sync fails. The status
      // indicator records the failure, and existing browser persistence remains intact.
    } finally {
      window.location.assign(gameId ? `/games/${gameId}` : "/");
    }
  };

  const focusPlayer = () => document.querySelector<HTMLElement>("#game")?.focus({ preventScroll: true });

  useEffect(() => {
    let cancelled = false;
    void api
      .launch(gameId)
      .then(({ manifest: resolved }) => {
        if (!cancelled) setManifest(resolved);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "This game could not be prepared.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (!manifest) return;
    failed.current = false;
    return adapter.mount(manifest, {
      onReady: () => { if (!failed.current) setStatus("loading"); },
      onRunning: () => { if (!failed.current) setStatus("running"); },
      onExit: () => window.location.assign(gameId ? `/games/${gameId}` : "/"),
      onError: (error) => {
        failed.current = true;
        setMessage(error);
        setStatus("error");
      },
      onSaveStatus: setSaveStatus,
    });
  }, [adapter, gameId, manifest]);

  return (
    <main className="player-page">
      <header className="player-topbar">
        <button type="button" className="player-back" onClick={() => void leavePlayer()} disabled={leaving}>{leaving ? "Saving…" : "← Leave player"}</button>
        <strong>{manifest?.gameName ?? "Preparing game"}</strong>
        <SaveIndicator status={saveStatus} hasExistingSave={Boolean(manifest?.saveStateUrl)} />
      </header>

      <section className="player-stage" aria-label="Game player" onPointerDown={focusPlayer}>
        <div id="game" />
        {status !== "running" && (
          <div className={`player-overlay${status === "error" ? " player-error" : ""}`}>
            {status === "error" ? (
              <>
                <span className="error-pixel" aria-hidden="true">!</span>
                <p className="eyebrow">Playback stopped</p>
                <h1>{message}</h1>
                <p>Your library file was not changed.</p>
                <a href={`/games/${gameId}`} className="primary-button" data-controller-target>Back to game</a>
              </>
            ) : (
              <><Spinner /><p className="eyebrow">{status === "preparing" ? "Resolving game" : "Starting player"}</p><h1>Powering on…</h1></>
            )}
          </div>
        )}
      </section>
      <footer className="player-help">
        <span>Progress saves automatically when you leave.</span>
        <span><b>Save State</b> also creates a server checkpoint at any time.</span>
      </footer>
    </main>
  );
}

function SaveIndicator({ status, hasExistingSave }: { status: SaveStatus; hasExistingSave: boolean }): React.JSX.Element {
  const labels: Record<SaveStatus, string> = {
    idle: hasExistingSave ? "Saved progress available" : "Save ready",
    loaded: "Saved progress loaded",
    syncing: "Saving to server…",
    saved: "Saved to server",
    error: "Browser save kept · server sync failed",
  };
  return <span className={`save-indicator save-${status}`}><i />{labels[status]}</span>;
}
