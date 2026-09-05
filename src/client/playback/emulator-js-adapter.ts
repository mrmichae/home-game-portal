import { WEB_CHECKPOINT_COMPATIBILITY, type ControllerPresetKey, type LaunchManifest, type PlatformKey, type WebCoreKey } from "../../domain/types";
import { ResumeCoordinator, type RestoreResult, type ResumableGameManager } from "./resume-coordinator";

type SaveStatus = "idle" | "loaded" | "fresh" | "syncing" | "saved" | "error";
const emulatorJsAssetVersion = WEB_CHECKPOINT_COMPATIBILITY.runtimeVersion;

export interface PlaybackCallbacks {
  onReady: () => void;
  onRunning: () => void;
  onExit: () => void;
  onError: (message: string) => void;
  onSaveStatus: (status: SaveStatus) => void;
}

interface RuntimeOptions {
  locateFile?: (filename: string, scriptDirectory?: string) => string;
  [key: string]: unknown;
}

interface EmulatorGameManager {
  getState?: () => Uint8Array;
  getFrameNum?: () => number;
  loadState?: (state: Uint8Array) => void;
  restart?: () => void;
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
  EJS_softLoad?: number;
  EJS_loadStateURL?: string;
  EJS_defaultOptions?: Record<string, string>;
  EJS_defaultControls?: EmulatorDefaultControls;
  EJS_hideSettings?: string[];
  EJS_Buttons?: Record<string, boolean>;
  EJS_ready?: () => void;
  EJS_onGameStart?: () => void;
  EJS_onLoadState?: unknown;
  EJS_onSaveState?: unknown;
  EJS_onExit?: () => void;
  EJS_emulator?: {
    callEvent?: (event: string) => void;
    gameManager?: EmulatorGameManager;
    paused?: boolean;
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

const snesKeyboardControls: EmulatorDefaultControls[0] = {
  ...keyboardControls,
  1: { value: "a" },
  9: { value: "s" },
  10: { value: "q" },
  11: { value: "w" },
};

const snesGamepadControls: EmulatorDefaultControls[0] = {
  ...standardGamepadControls,
  1: { value: "a", value2: "BUTTON_4" },
  9: { value: "s", value2: "BUTTON_3" },
  10: { value: "q", value2: "LEFT_TOP_SHOULDER" },
  11: { value: "w", value2: "RIGHT_TOP_SHOULDER" },
};

export function controllerMappingFor(preset: ControllerPresetKey, platform: PlatformKey = "nes"): EmulatorDefaultControls {
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
    return fourPlayerMapping(platform === "snes" ? snesGamepadControls : standardGamepadControls);
  }
  return fourPlayerMapping(platform === "snes" ? snesKeyboardControls : keyboardControls);
}

function fourPlayerMapping(playerOne: EmulatorDefaultControls[0]): EmulatorDefaultControls {
  return { 0: structuredClone(playerOne), 1: {}, 2: {}, 3: {} };
}

interface CheckpointGatedStartOptions {
  restore: () => Promise<RestoreResult>;
  onRestoreResult: (result: RestoreResult) => void;
  onRestoreError: () => void;
  onRunning: () => void;
  isDisposed: () => boolean;
}

/**
 * `EJS_softLoad` is a global, optional EmulatorJS integration setting. When it
 * is positive, EmulatorJS schedules a core restart after that many seconds.
 * The portal owns resume explicitly, so a value left behind by an older player
 * instance must never become an implicit mid-session restart policy.
 */
export function disableImplicitCoreRestart(host: { EJS_softLoad?: number }): void {
  host.EJS_softLoad = 0;
}

export function isBenignRuntimeRejection(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  return reason.name === "NotAllowedError" && /wake lock/i.test(reason.message);
}

/**
 * EmulatorJS exposes a repeatable start event, while checkpoint restoration is
 * a one-time startup transition. Keep gameplay behind that transition so a
 * delayed restore or rollback can never interrupt an already-running session.
 */
export function createCheckpointGatedStartHandler(options: CheckpointGatedStartOptions): () => void {
  let started = false;
  return () => {
    if (started || options.isDisposed()) return;
    started = true;
    void options.restore()
      .then((result) => {
        if (!options.isDisposed()) options.onRestoreResult(result);
      })
      .catch(() => {
        if (!options.isDisposed()) options.onRestoreError();
      })
      .finally(() => {
        if (!options.isDisposed()) options.onRunning();
      });
  };
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

export class EmulatorJsPlaybackAdapter implements PlaybackAdapter {
  private saveCurrentState: (() => Promise<void>) | null = null;
  private readonly resumeCoordinator = new ResumeCoordinator();

  save(): Promise<void> {
    return this.saveCurrentState?.() ?? Promise.reject(new Error("The game is not ready to save."));
  }

  mount(manifest: LaunchManifest, callbacks: PlaybackCallbacks): () => void {
    const host = window as EmulatorWindow;
    const runtimeProfile = selectRuntimeProfile({
      crossOriginIsolated: window.crossOriginIsolated === true,
      hasSharedArrayBuffer: typeof window.SharedArrayBuffer === "function",
      userAgent: window.navigator.userAgent,
      vendor: window.navigator.vendor,
      platform: window.navigator.platform,
      maxTouchPoints: window.navigator.maxTouchPoints,
    }, manifest.playbackProfile.core);
    const exitCoordinator = new PlaybackExitCoordinator(callbacks.onExit);
    const startupRequest = new AbortController();
    const gameFilePromise = fetchGameFile(manifest.gameUrl, startupRequest.signal, manifest.platform);
    let running = false;
    let failed = false;
    let disposed = false;
    let gameFileUrl: string | null = null;
    const reportError = (message: string) => {
      if (failed || running) return;
      failed = true;
      callbacks.onError(message);
    };

    // These resolved facts remain inside the adapter; the player never chooses them.
    disableImplicitCoreRestart(host);
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
    host.EJS_defaultControls = controllerMappingFor(manifest.controllerPreset, manifest.platform);
    host.EJS_hideSettings = ["core", "change-core", "save-state-location"];
    host.EJS_Buttons = { netplay: false, settings: false, exitEmulation: false };
    host.EJS_ready = callbacks.onReady;
    host.EJS_onGameStart = createCheckpointGatedStartHandler({
      restore: () => this.resumeCoordinator.restore(
        manifest.resumePlan,
        () => resumableGameManager(host.EJS_emulator?.gameManager),
        () => disposed,
      ),
      onRestoreResult: (result) => {
        if (result.status === "restored") callbacks.onSaveStatus("loaded");
        if (result.status === "fresh") callbacks.onSaveStatus("fresh");
      },
      onRestoreError: () => callbacks.onSaveStatus("error"),
      onRunning: () => {
        running = true;
        this.saveCurrentState = async () => {
          const gameManager = resumableGameManager(host.EJS_emulator?.gameManager);
          if (!gameManager) throw new Error("The game is not ready to create a checkpoint.");
          callbacks.onSaveStatus("syncing");
          try {
            await this.resumeCoordinator.capture(
              manifest.resumePlan,
              gameManager,
              () => host.EJS_emulator?.paused === true,
            );
            callbacks.onSaveStatus("saved");
          } catch (error) {
            callbacks.onSaveStatus("error");
            throw error;
          }
        };
        window.requestAnimationFrame(() => document.querySelector<HTMLElement>("#game")?.focus({ preventScroll: true }));
        callbacks.onRunning();
      },
      isDisposed: () => disposed,
    });
    // Do not register the load/save state events. EmulatorJS skips its own
    // IndexedDB behavior whenever either event has a listener; leaving both
    // alone preserves browser-native Save State and Load State as an independent
    // recovery path.
    delete host.EJS_onLoadState;
    delete host.EJS_onSaveState;
    host.EJS_onExit = exitCoordinator.handleEmulatorExit;

    const onWindowError = (event: ErrorEvent) => {
      if (!running) {
        console.error("[Home Game Portal] EmulatorJS runtime error", event.message, event.error);
        reportError(playerMessage(event.error ?? event.message));
      }
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isBenignRuntimeRejection(event.reason)) {
        event.preventDefault();
        return;
      }
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
        reportError("The game player could not be loaded.");
        return;
      }
      wrappedRuntime = (options = {}) => {
        const upstreamLocateFile = options.locateFile;
        return upstreamRuntime({
          ...options,
          locateFile: (filename: string, scriptDirectory?: string) =>
            resolveLibretroRuntimeFile(filename, scriptDirectory, upstreamLocateFile, runtimeProfile.wasmPath),
        });
      };
      host.EJS_Runtime = wrappedRuntime;
      try {
        const gameFile = await gameFilePromise;
        gameFileUrl = URL.createObjectURL(gameFile);
        // EmulatorJS derives a virtual filename from the URL. Preserve the platform
        // extension in the fragment while retaining the revocable object URL.
        host.EJS_gameUrl = `${gameFileUrl}#game.${manifest.platform === "snes" ? "sfc" : "nes"}`;
      } catch (error) {
        if (!disposed) reportError(playerMessage(error));
        return;
      }
      if (disposed) return;
      document.body.appendChild(loaderScript);
    };
    runtimeScript.onerror = () => reportError("The game player could not be loaded.");
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
  platform: PlatformKey = "nes",
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  const response = await fetcher(gameUrl, { cache: "no-store", signal });
  if (!response.ok) throw new Error("The game file could not be read from the server. Check the Library Source, then rescan and try again.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const valid = platform === "snes"
    ? isValidSnesRom(bytes)
    : bytes.byteLength >= 16 && bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a;
  if (!valid) throw new Error(`The selected file is not a valid ${platform === "snes" ? "Super Nintendo" : "NES"} game. The source file was not changed.`);
  return new Blob([bytes], { type: "application/octet-stream" });
}

export function resolveLibretroRuntimeFile(
  filename: string,
  scriptDirectory?: string,
  upstreamLocateFile?: RuntimeOptions["locateFile"],
  wasmPath = "/emulatorjs/cores/fceumm_libretro.wasm",
): string {
  if (filename.endsWith(".wasm")) return wasmPath;
  return upstreamLocateFile?.(filename, scriptDirectory) ?? `${scriptDirectory ?? ""}${filename}`;
}

export const resolveFceummRuntimeFile = resolveLibretroRuntimeFile;

export function selectRuntimeProfile(environment: {
  crossOriginIsolated: boolean;
  hasSharedArrayBuffer: boolean;
  userAgent?: string;
  vendor?: string;
  platform?: string;
  maxTouchPoints?: number;
}, coreKey: WebCoreKey = "fceumm"): RuntimeProfile {
  const coreAssetName = coreKey === "snes9x" ? "snes9x" : "fceumm";
  if (environment.crossOriginIsolated && environment.hasSharedArrayBuffer && !isAppleWebKit(environment)) {
    return {
      threaded: true,
      scriptPath: `/emulatorjs/cores/${coreAssetName}_thread_libretro.js`,
      wasmPath: `/emulatorjs/cores/${coreAssetName}_thread_libretro.wasm`,
    };
  }
  return {
    threaded: false,
    scriptPath: `/emulatorjs/cores/${coreAssetName}_libretro.js`,
    wasmPath: `/emulatorjs/cores/${coreAssetName}_libretro.wasm`,
  };
}

function isAppleWebKit(environment: {
  userAgent?: string;
  vendor?: string;
  platform?: string;
  maxTouchPoints?: number;
}): boolean {
  const userAgent = environment.userAgent ?? "";
  const isAppleMobile = /iPad|iPhone|iPod/i.test(userAgent)
    || (environment.platform === "MacIntel" && (environment.maxTouchPoints ?? 0) > 1);
  const isDesktopSafari = /Safari/i.test(userAgent)
    && /Apple/i.test(environment.vendor ?? "")
    && !/(Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|FxiOS)/i.test(userAgent);

  // WebKit can retain or over-count SharedArrayBuffer-backed Wasm memory across
  // workers and reloads. FCEUmm is fast enough without pthreads on Apple devices,
  // so prefer its lower-overhead single-thread runtime there.
  return isAppleMobile || isDesktopSafari;
}

function isValidSnesRom(bytes: Uint8Array): boolean {
  const copierHeaderSize = bytes.byteLength % 0x8000 === 512 ? 512 : 0;
  return [0x7fc0, 0xffc0, 0x40ffc0].some((baseOffset) => {
    const offset = copierHeaderSize + baseOffset;
    if (offset + 64 > bytes.byteLength) return false;
    const header = bytes.subarray(offset, offset + 64);
    const mapMode = header[0x15] & 0x3f;
    let score = [0x20, 0x21, 0x22, 0x23, 0x25, 0x30, 0x31, 0x32, 0x35].includes(mapMode) ? 2 : 0;
    const complement = header[0x1c] | (header[0x1d] << 8);
    const checksum = header[0x1e] | (header[0x1f] << 8);
    if ((complement ^ checksum) === 0xffff && (complement !== 0 || checksum !== 0)) score += 2;
    if ((header[0x3c] | (header[0x3d] << 8)) >= 0x8000) score += 2;
    if (header.subarray(0, 21).filter((byte) => byte === 0 || byte === 0x20 || (byte >= 0x21 && byte <= 0x7e)).length >= 18) score += 1;
    if (header[0x17] >= 0x08 && header[0x17] <= 0x0f) score += 1;
    return score >= 4;
  });
}
function playerMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/fetch|network|download/i.test(message)) {
    return "The game file could not be read. Check the library mount, then try again.";
  }
  return "This game could not start in the browser. Your library file was not changed.";
}

function resumableGameManager(gameManager?: EmulatorGameManager): ResumableGameManager | undefined {
  return gameManager?.getState && gameManager.getFrameNum && gameManager.loadState
    ? gameManager as ResumableGameManager
    : undefined;
}
