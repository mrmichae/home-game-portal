import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { LaunchManifest } from "../../domain/types";
import { api } from "../api";
import { Spinner } from "../components";
import { gameplayChromeVisibility, isDeliberateVerticalSwipe, isDeliberateVerticalWheel, type GesturePoint } from "../gameplay-chrome";
import { EmulatorJsPlaybackAdapter } from "../playback/emulator-js-adapter";

type PlayerStatus = "preparing" | "loading" | "running" | "error";
type SaveStatus = "idle" | "loaded" | "fresh" | "syncing" | "saved" | "error";

export function PlayerPage(): React.JSX.Element {
  const { gameId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const selectedSavedStateId = searchParams.get("savedState");
  const adapter = useMemo(() => new EmulatorJsPlaybackAdapter(), []);
  const [manifest, setManifest] = useState<LaunchManifest | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("preparing");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [leaving, setLeaving] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  const [savingSavedState, setSavingSavedState] = useState(false);
  const [pauseMessage, setPauseMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const failed = useRef(false);
  const running = useRef(false);
  const leavingRef = useRef(false);
  const gestureStart = useRef<GesturePoint | null>(null);
  const gestureRevealedChrome = useRef(false);
  const chromeHideTimer = useRef<number | null>(null);

  const clearChromeTimer = () => {
    if (chromeHideTimer.current !== null) window.clearTimeout(chromeHideTimer.current);
    chromeHideTimer.current = null;
  };

  const revealChrome = () => {
    if (status !== "running") return;
    clearChromeTimer();
    setChromeVisible((current) => gameplayChromeVisibility(current, "deliberate-vertical-gesture"));
    chromeHideTimer.current = window.setTimeout(() => {
      setChromeVisible((current) => gameplayChromeVisibility(current, "gameplay-input"));
      chromeHideTimer.current = null;
    }, 4_500);
  };

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

  const pausePlayer = () => {
    if (status !== "running") return;
    clearChromeTimer();
    adapter.pause();
    setPaused(true);
    setChromeVisible(true);
    setPauseMessage(null);
  };

  const resumePlayer = () => {
    adapter.resume();
    setPaused(false);
    setPauseMessage(null);
    focusPlayer();
  };

  const createSavedState = async () => {
    if (!manifest || savingSavedState) return;
    setSavingSavedState(true);
    setPauseMessage(null);
    try {
      const capture = await adapter.captureSavedState();
      await api.createSavedState(manifest.savedStateCaptureUrl, capture.state, capture.capturedFrame, capture.thumbnail);
      setPauseMessage("Saved state created. It is now available from this game's detail page.");
    } catch (error) {
      setPauseMessage(error instanceof Error ? error.message : "The saved state could not be created.");
    } finally {
      setSavingSavedState(false);
    }
  };

  const focusPlayer = () => document.querySelector<HTMLElement>("#game")?.focus({ preventScroll: true });

  const beginGameplayGesture = (event: React.PointerEvent<HTMLElement>) => {
    focusPlayer();
    if (status === "running" && chromeVisible) {
      clearChromeTimer();
      setChromeVisible((current) => gameplayChromeVisibility(current, "gameplay-input"));
    }
    if (event.pointerType === "touch") {
      gestureStart.current = { x: event.clientX, y: event.clientY };
      gestureRevealedChrome.current = false;
    }
  };

  const continueGameplayGesture = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch" || !gestureStart.current || gestureRevealedChrome.current) return;
    if (!isDeliberateVerticalSwipe(gestureStart.current, { x: event.clientX, y: event.clientY })) return;
    gestureRevealedChrome.current = true;
    revealChrome();
  };

  const endGameplayGesture = () => {
    gestureStart.current = null;
    gestureRevealedChrome.current = false;
  };

  useEffect(() => {
    let cancelled = false;
    void api
      .launch(gameId, selectedSavedStateId)
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
  }, [gameId, selectedSavedStateId]);

  useEffect(() => {
    if (!manifest) return;
    failed.current = false;
    running.current = false;
    return adapter.mount(manifest, {
      onReady: () => { if (!failed.current && !running.current) setStatus("loading"); },
      onRunning: () => { if (!failed.current) { running.current = true; setStatus("running"); } },
      onExit: () => window.location.assign(gameId ? `/games/${gameId}` : "/"),
      onError: (error) => {
        failed.current = true;
        setMessage(error);
        setStatus("error");
      },
      onSaveStatus: setSaveStatus,
    });
  }, [adapter, gameId, manifest]);

  useEffect(() => {
    if (status === "running" && !paused) {
      clearChromeTimer();
      setChromeVisible((current) => gameplayChromeVisibility(current, "game-running"));
    }
    return clearChromeTimer;
  }, [paused, status]);

  return (
    <main className={`player-page player-chrome-${chromeVisible ? "visible" : "hidden"}`}>
      {chromeVisible && <header className="player-topbar">
        <button type="button" className="player-back" onClick={() => void leavePlayer()} disabled={leaving}>{leaving ? "Saving…" : "← Leave player"}</button>
        <strong>{manifest?.gameName ?? "Preparing game"}</strong>
        <div className="player-topbar-actions">
          {status === "running" && <button type="button" className="player-pause" onClick={paused ? resumePlayer : pausePlayer}>{paused ? "Resume" : "Pause"}</button>}
          <SaveIndicator status={saveStatus} hasExistingSave={Boolean(manifest?.resumePlan.checkpoints.length)} />
        </div>
      </header>}

      <section
        className="player-stage"
        aria-label="Game player. Swipe vertically or press Escape to show player controls."
        onPointerDown={beginGameplayGesture}
        onPointerMove={continueGameplayGesture}
        onPointerUp={endGameplayGesture}
        onPointerCancel={endGameplayGesture}
        onWheel={(event) => { if (isDeliberateVerticalWheel(event.deltaX, event.deltaY)) revealChrome(); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); paused ? resumePlayer() : pausePlayer(); } }}
      >
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
        {status === "running" && paused && (
          <div className="pause-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <p className="eyebrow">Game paused</p>
            <h1 id="pause-title">{manifest?.gameName}</h1>
            <p>Create a durable saved state at this exact moment, or resume when you’re ready.</p>
            <div className="pause-actions">
              <button type="button" className="stream-button primary" onClick={resumePlayer} autoFocus data-controller-target>Resume</button>
              <button type="button" className="stream-button secondary" onClick={() => void createSavedState()} disabled={savingSavedState} data-controller-target>{savingSavedState ? "Saving…" : "Save State"}</button>
              <button type="button" className="stream-button secondary" onClick={() => void leavePlayer()} disabled={leaving} data-controller-target>Return to Game Details</button>
            </div>
            {pauseMessage && <p className="pause-message" role="status">{pauseMessage}</p>}
          </div>
        )}
      </section>
      {chromeVisible && <footer className="player-help">
        <span>Progress saves automatically when you leave.</span>
        <span><b>Save State</b> keeps a browser checkpoint as an independent fallback.</span>
      </footer>}
    </main>
  );
}

function SaveIndicator({ status, hasExistingSave }: { status: SaveStatus; hasExistingSave: boolean }): React.JSX.Element {
  const labels: Record<SaveStatus, string> = {
    idle: hasExistingSave ? "Saved progress available" : "Save ready",
    loaded: "Saved progress loaded",
    fresh: "Previous checkpoint skipped · started fresh",
    syncing: "Saving to server…",
    saved: "Saved to server",
    error: "Server sync failed · browser fallback unchanged",
  };
  return <span className={`save-indicator save-${status}`}><i />{labels[status]}</span>;
}
