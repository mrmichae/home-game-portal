import type { ControllerPresetKey, LaunchManifest } from "../../domain/types";

type SaveStatus = "idle" | "loaded" | "syncing" | "saved" | "error";
const emulatorJsAssetVersion = "4.2.3-portal.2";

export interface PlaybackCallbacks {
  onReady: () => void;
  onRunning: () => void;
  onExit: () => void;
  onError: (message: string) => void;
  onSaveStatus: (status: SaveStatus) => void;
}

interface SaveStateEvent {
  state: ArrayBuffer | Uint8Array;
}

interface RuntimeOptions {
  locateFile?: (filename: string, scriptDirectory?: string) => string;
  [key: string]: unknown;
}

interface EmulatorGameManager {
  getState?: () => Uint8Array;
  loadState?: (state: Uint8Array) => void;
}

interface EmulatorWindow extends Window {
  EJS_player?: string;
  EJS_gameUrl?: string;
  EJS_core?: string;
  EJS_gameName?: string;
  EJS_gameID?: number;
  EJS_pathtodata?: string;
  EJS_startOnLoaded?: boolean;
  EJS_fullscreenOnLoaded?: boolean;
  EJS_threads?: boolean;
  EJS_noAutoFocus?: boolean;
  EJS_language?: string;
  EJS_disableAutoLang?: boolean;
  EJS_backgroundColor?: string;
  EJS_color?: string;
  EJS_startButtonName?: string;
  EJS_loadStateURL?: string;
  EJS_defaultOptions?: Record<string, string>;
  EJS_defaultControls?: EmulatorDefaultControls;
  EJS_hideSettings?: string[];
  EJS_Buttons?: Record<string, boolean>;
  EJS_ready?: () => void;
  EJS_onGameStart?: () => void;
  EJS_onLoadState?: () => void;
  EJS_onSaveState?: (event: SaveStateEvent) => void;
  EJS_onExit?: () => void;
  EJS_emulator?: {
    callEvent?: (event: string) => void;
    gameManager?: EmulatorGameManager;
  };
  EJS_Runtime?: (options?: RuntimeOptions) => unknown;
}

export interface PlaybackAdapter {
  mount(manifest: LaunchManifest, callbacks: PlaybackCallbacks): () => void;
  save(): Promise<void>;
}

export interface RuntimeProfile {
  threaded: boolean;
  scriptPath: string;
  wasmPath: string;
}

export type EmulatorDefaultControls = Record<number, Record<number, { value: string; value2?: string }>>;

const keyboardControls: EmulatorDefaultControls[0] = {
  0: { value: "x" },
  2: { value: "v" },
  3: { value: "enter" },
  4: { value: "up arrow" },
  5: { value: "down arrow" },
  6: { value: "left arrow" },
  7: { value: "right arrow" },
  8: { value: "z" },
};

const standardGamepadControls: EmulatorDefaultControls[0] = {
  0: { value: "x", value2: "BUTTON_2" },
  2: { value: "v", value2: "SELECT" },
  3: { value: "enter", value2: "START" },
  4: { value: "up arrow", value2: "DPAD_UP" },
  5: { value: "down arrow", value2: "DPAD_DOWN" },
  6: { value: "left arrow", value2: "DPAD_LEFT" },
  7: { value: "right arrow", value2: "DPAD_RIGHT" },
  8: { value: "z", value2: "BUTTON_1" },
};

export function controllerMappingFor(preset: ControllerPresetKey): EmulatorDefaultControls {
  if (preset === "apple-tv-remote") {
    return fourPlayerMapping({
      0: { value: "space" },
      2: { value: "backspace" },
      3: { value: "p" },
      4: { value: "up arrow" },
      5: { value: "down arrow" },
      6: { value: "left arrow" },
      7: { value: "right arrow" },
      8: { value: "enter" },
    });
  }
  if (preset === "joy-con" || preset === "switch-pro") {
    return fourPlayerMapping(standardGamepadControls);
  }
  return fourPlayerMapping(keyboardControls);
}

function fourPlayerMapping(playerOne: EmulatorDefaultControls[0]): EmulatorDefaultControls {
  return { 0: structuredClone(playerOne), 1: {}, 2: {}, 3: {} };
}

export class PlaybackExitCoordinator {
  private isUnmounting = false;
  private hasExited = false;

  constructor(private readonly onExit: () => void) {}

  readonly handleEmulatorExit = (): void => {
    this.hasExited = true;
    if (!this.isUnmounting) this.onExit();
  };

  teardown(emulator?: EmulatorWindow["EJS_emulator"]): void {
    this.isUnmounting = true;
    if (this.hasExited) return;
    this.hasExited = true;
    try {
      emulator?.callEvent?.("exit");
    } catch (error) {
      // A core may throw while aborting its WebAssembly runtime. Route cleanup must
      // never let that exception escape into React and unmount the whole app.
      console.warn("[Home Game Portal] EmulatorJS did not shut down cleanly", error);
    }
  }
}

export class PlaybackSaveSession {
  constructor(
    private readonly persist: (state: ArrayBuffer) => Promise<void>,
    private readonly onStatus: (status: SaveStatus) => void,
  ) {}

  async save(state: ArrayBuffer | Uint8Array): Promise<void> {
    this.onStatus("syncing");
    try {
      const body = state instanceof Uint8Array ? state.slice().buffer as ArrayBuffer : state.slice(0);
      await this.persist(body);
      this.onStatus("saved");
    } catch (error) {
      this.onStatus("error");
      throw error;
    }
  }
}

export class InitialStateRestorer {
  private restored = false;

  constructor(private readonly state: Uint8Array | null) {}

  restore(gameManager?: EmulatorGameManager): boolean {
    if (this.restored || !this.state?.byteLength || !gameManager?.loadState) return false;
    this.restored = true;
    gameManager.loadState(this.state);
    return true;
  }
}

export class EmulatorJsPlaybackAdapter implements PlaybackAdapter {
  private saveCurrentState: (() => Promise<void>) | null = null;

  save(): Promise<void> {
    return this.saveCurrentState?.() ?? Promise.reject(new Error("The game is not ready to save."));
  }

  mount(manifest: LaunchManifest, callbacks: PlaybackCallbacks): () => void {
    const host = window as EmulatorWindow;
    const runtimeProfile = selectRuntimeProfile({
      crossOriginIsolated: window.crossOriginIsolated === true,
      hasSharedArrayBuffer: typeof window.SharedArrayBuffer === "function",
    });
    const exitCoordinator = new PlaybackExitCoordinator(callbacks.onExit);
    const startupRequest = new AbortController();
    const gameFilePromise = fetchGameFile(manifest.gameUrl, startupRequest.signal);
    const initialStatePromise = fetchInitialState(manifest.saveStateUrl, startupRequest.signal);
    let running = false;
    let failed = false;
    let disposed = false;
    let initialStateRestorer: InitialStateRestorer | null = null;
    let gameFileUrl: string | null = null;
    const reportError = (message: string) => {
      if (failed || running) return;
      failed = true;
      callbacks.onError(message);
    };

    // These resolved facts remain inside the adapter; the player never chooses them.
    host.EJS_player = "#game";
    // Fetch the scoped server URL ourselves before starting EmulatorJS. Its internal
    // downloader reports only "Network Error" in some reverse-proxy/container setups.
    // A browser-local object URL gives the runtime a stable, already-validated file.
    host.EJS_gameUrl = "";
    host.EJS_core = manifest.playbackProfile.core;
    host.EJS_gameName = manifest.gameName;
    host.EJS_gameID = Number.parseInt(manifest.gameId.slice(0, 8), 16);
    host.EJS_pathtodata = "/emulatorjs/";
    host.EJS_startOnLoaded = true;
    host.EJS_fullscreenOnLoaded = false;
    host.EJS_threads = runtimeProfile.threaded;
    host.EJS_noAutoFocus = true;
    host.EJS_language = "en-US";
    host.EJS_disableAutoLang = false;
    host.EJS_backgroundColor = "#0b0c0f";
    host.EJS_color = "#e5222d";
    host.EJS_startButtonName = `Start ${manifest.gameName}`;
    // EmulatorJS registers EJS_loadStateURL with a repeatable `start` listener.
    // Own restoration here so a later runtime start event cannot rewind gameplay.
    host.EJS_loadStateURL = "";
    host.EJS_defaultOptions = { "save-state-location": "browser" };
    host.EJS_defaultControls = controllerMappingFor(manifest.controllerPreset);
    host.EJS_hideSettings = ["core", "change-core", "save-state-location"];
    host.EJS_Buttons = { netplay: false, settings: false, exitEmulation: false };
    const saveSession = new PlaybackSaveSession(async (body) => {
      const response = await fetch(`/api/saves/${manifest.gameId}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "X-Player-Profile": manifest.playerProfileKey },
        body,
      });
      if (!response.ok) throw new Error("Save sync failed.");
    }, callbacks.onSaveStatus);
    host.EJS_ready = callbacks.onReady;
    host.EJS_onGameStart = () => {
      running = true;
      this.saveCurrentState = async () => {
        const state = host.EJS_emulator?.gameManager?.getState?.();
        if (!state?.byteLength) throw new Error("The game did not provide save data.");
        await saveSession.save(state);
      };
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>("#game")?.focus({ preventScroll: true }));
      callbacks.onRunning();
      window.setTimeout(() => {
        if (initialStateRestorer?.restore(host.EJS_emulator?.gameManager)) {
          callbacks.onSaveStatus("loaded");
        }
      }, 10);
    };
    host.EJS_onLoadState = () => callbacks.onSaveStatus("loaded");
    host.EJS_onSaveState = ({ state }) => {
      void saveSession.save(state).catch(() => undefined);
    };
    host.EJS_onExit = exitCoordinator.handleEmulatorExit;

    const onWindowError = (event: ErrorEvent) => {
      if (!running) {
        console.error("[Home Game Portal] EmulatorJS runtime error", event.message, event.error);
        reportError(playerMessage(event.error ?? event.message));
      }
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!running) {
        console.error("[Home Game Portal] EmulatorJS rejected a startup task", event.reason);
        reportError(playerMessage(event.reason));
      }
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const runtimeScript = document.createElement("script");
    runtimeScript.src = `${runtimeProfile.scriptPath}?v=${emulatorJsAssetVersion}`;
    runtimeScript.dataset.ejsRuntime = "true";
    const loaderScript = document.createElement("script");
    loaderScript.src = `/emulatorjs/loader.js?v=${emulatorJsAssetVersion}`;
    loaderScript.dataset.ejsLoader = "true";
    loaderScript.onerror = () => reportError("The game player could not be loaded.");
    let wrappedRuntime: EmulatorWindow["EJS_Runtime"];
    runtimeScript.onload = async () => {
      const upstreamRuntime = host.EJS_Runtime;
      if (!upstreamRuntime) {
        reportError("The NES player could not be loaded.");
        return;
      }
      wrappedRuntime = (options = {}) => {
        const upstreamLocateFile = options.locateFile;
        return upstreamRuntime({
          ...options,
          locateFile: (filename: string, scriptDirectory?: string) =>
            resolveFceummRuntimeFile(filename, scriptDirectory, upstreamLocateFile, runtimeProfile.wasmPath),
        });
      };
      host.EJS_Runtime = wrappedRuntime;
      try {
        const [gameFile, initialState] = await Promise.all([gameFilePromise, initialStatePromise]);
        gameFileUrl = URL.createObjectURL(gameFile);
        // EmulatorJS derives a virtual filename from the URL. Preserve the platform
        // extension in the fragment while retaining the revocable object URL.
        host.EJS_gameUrl = `${gameFileUrl}#game.nes`;
        initialStateRestorer = new InitialStateRestorer(initialState);
      } catch (error) {
        if (!disposed) reportError(playerMessage(error));
        return;
      }
      if (disposed) return;
      document.body.appendChild(loaderScript);
    };
    runtimeScript.onerror = () => reportError("The NES player could not be loaded.");
    document.body.appendChild(runtimeScript);

    const timeout = window.setTimeout(() => {
      if (!running && !failed) {
        reportError("The game took too long to start. Return to the shelf and try again.");
      }
    }, 30_000);

    return () => {
      disposed = true;
      startupRequest.abort();
      this.saveCurrentState = null;
      window.clearTimeout(timeout);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      exitCoordinator.teardown(host.EJS_emulator);
      if (wrappedRuntime && host.EJS_Runtime === wrappedRuntime) delete host.EJS_Runtime;
      if (gameFileUrl) URL.revokeObjectURL(gameFileUrl);
      runtimeScript.remove();
      loaderScript.remove();
      document.querySelectorAll("[data-ejs-loader='true']").forEach((element) => element.remove());
      document.querySelectorAll("[data-ejs-runtime='true']").forEach((element) => element.remove());
    };
  }
}

export async function fetchGameFile(
  gameUrl: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  const response = await fetcher(gameUrl, { cache: "no-store", signal });
  if (!response.ok) throw new Error("The game file could not be read from the server. Check the Library Source, then rescan and try again.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 16 || bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
    throw new Error("The selected file is not a valid NES game. The source file was not changed.");
  }
  return new Blob([bytes], { type: "application/octet-stream" });
}

async function fetchInitialState(saveStateUrl: string | null, signal: AbortSignal): Promise<Uint8Array | null> {
  if (!saveStateUrl) return null;
  const response = await fetch(saveStateUrl, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Saved progress could not be loaded. Remove it from Continue Playing to start fresh.");
  const state = new Uint8Array(await response.arrayBuffer());
  if (!state.byteLength) throw new Error("Saved progress is empty. Remove it from Continue Playing to start fresh.");
  return state;
}

export function resolveFceummRuntimeFile(
  filename: string,
  scriptDirectory?: string,
  upstreamLocateFile?: RuntimeOptions["locateFile"],
  wasmPath = "/emulatorjs/cores/fceumm_libretro.wasm",
): string {
  if (filename.endsWith(".wasm")) return wasmPath;
  return upstreamLocateFile?.(filename, scriptDirectory) ?? `${scriptDirectory ?? ""}${filename}`;
}

export function selectRuntimeProfile(environment: {
  crossOriginIsolated: boolean;
  hasSharedArrayBuffer: boolean;
}): RuntimeProfile {
  if (environment.crossOriginIsolated && environment.hasSharedArrayBuffer) {
    return {
      threaded: true,
      scriptPath: "/emulatorjs/cores/fceumm_thread_libretro.js",
      wasmPath: "/emulatorjs/cores/fceumm_thread_libretro.wasm",
    };
  }
  return {
    threaded: false,
    scriptPath: "/emulatorjs/cores/fceumm_libretro.js",
    wasmPath: "/emulatorjs/cores/fceumm_libretro.wasm",
  };
}

function playerMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/fetch|network|download/i.test(message)) {
    return "The game file could not be read. Check the library mount, then try again.";
  }
  return "This game could not start in the browser. Your library file was not changed.";
}
