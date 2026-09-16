import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmulatorJsPlaybackAdapter } from "./emulator-js-adapter";
import type { LaunchManifest } from "../../domain/types";

// Execute the shipped startup and resize methods, including their delayed work.
const bundle = readFileSync("public/emulatorjs/emulator.min.js", "utf8");
function startup({ touch = false, setting = "enabled" } = {}) {
  const Runtime = runInNewContext(`${bundle.slice(bundle.indexOf("class EmulatorJS{"), bundle.indexOf("window.EmulatorJS="))}; EmulatorJS`, { setTimeout, console });
  const emulator = Object.create(Runtime.prototype);
  const element = () => ({ style: { display: "none", opacity: "" }, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, getBoundingClientRect: () => ({ width: 390 }) });
  Object.assign(emulator, {
    config: {}, Module: { callMain() {}, resumeMainLoop() {} }, gameManager: { getDiskCount: () => 0 },
    diskParent: element(), virtualGamepad: element(), textElem: element(), canvas: element(),
    game: { ...element(), parentElement: element() }, elements: { parent: { ...element(), focus() {} } },
    menu: { open() {} }, touch, hasTouchScreen: true, isMobile: true,
    getSettingValue: () => setting,
    checkSupportedOpts() {}, setupDisksMenu() {}, setupSettingsMenu() {}, loadSettings() {},
    updateCheatUI() {}, updateGamepadLabels() {}, setVolume() {}, callEvent() {},
  });
  emulator.startGame();
  return emulator;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("mobile startup in the bundled emulator", () => {
  it("shows an enabled gamepad after automatic startup and resize timers settle", () => {
    vi.useFakeTimers();
    const emulator = startup();
    vi.runAllTimers();
    expect(emulator.virtualGamepad.style.display).toBe("");
    expect(emulator.virtualGamepad.style.opacity).not.toBe(0);
  });

  it("does not let an earlier resize hide a subsequently enabled gamepad", () => {
    vi.useFakeTimers();
    const emulator = startup();
    emulator.virtualGamepad.style.display = "none";
    emulator.handleResize();
    emulator.virtualGamepad.style.display = "";
    vi.runAllTimers();
    expect(emulator.virtualGamepad.style.display).toBe("");
  });

  it("respects a disabled gamepad even when startup came from touch", () => {
    vi.useFakeTimers();
    const emulator = startup({ touch: true, setting: "disabled" });
    expect(emulator.virtualGamepad.style.display).toBe("none");
    vi.runAllTimers();
    expect(emulator.virtualGamepad.style.display).toBe("none");
  });
});

function mountWithAudio() {
  const game = new EventTarget();
  const host = Object.assign(new EventTarget(), {
    navigator: { userAgent: "iPhone", vendor: "Apple", platform: "iPhone", maxTouchPoints: 5 },
    setTimeout, clearTimeout,
  });
  const audio = { state: "suspended", resume: vi.fn(async () => { audio.state = "running"; }) };
  Object.assign(host, { EJS_emulator: { Module: { AL: { currentCtx: { audioCtx: audio } } } } });
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", { querySelector: () => game, querySelectorAll: () => [], createElement: () => ({ dataset: {}, remove() {} }), body: { appendChild() {} } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0x4e, 0x45, 0x53, 0x1a, ...Array(12).fill(0)]))));
  const dispose = new EmulatorJsPlaybackAdapter().mount({
    gameUrl: "/game", gameId: "12345678", gameName: "Test", platform: "nes", controllerPreset: "keyboard",
    playbackProfile: { core: "fceumm" },
  } as LaunchManifest, { onReady() {}, onRunning() {}, onExit() {}, onError() {}, onSaveStatus() {} });
  return { game, host, audio, dispose };
}

describe("gameplay audio activation", () => {
  it("resumes suspended audio on touch release and again after interruption", async () => {
    const { game, audio, dispose } = mountWithAudio();
    try {
      game.dispatchEvent(new Event("touchend"));
      expect(audio.state).toBe("running");
      await Promise.resolve();
      audio.state = "interrupted";
      game.dispatchEvent(new Event("touchend"));
      expect(audio.state).toBe("running");
    } finally { dispose(); }
  });

  it("removes activation listeners when playback ends", () => {
    const { game, audio, dispose } = mountWithAudio();
    dispose();
    game.dispatchEvent(new Event("touchend"));
    expect(audio.resume).not.toHaveBeenCalled();
  });

  it("retries after a rejected activation without restarting running audio", async () => {
    const { game, audio, dispose } = mountWithAudio();
    try {
      audio.resume.mockRejectedValueOnce(new Error("Activation required"));
      game.dispatchEvent(new Event("pointerdown"));
      await Promise.resolve();
      expect(audio.state).toBe("suspended");
      game.dispatchEvent(new Event("touchend"));
      expect(audio.state).toBe("running");
      game.dispatchEvent(new Event("click"));
      expect(audio.resume).toHaveBeenCalledTimes(2);
    } finally { dispose(); }
  });

  it("looks up audio created after an early gameplay gesture", () => {
    const { game, host, audio, dispose } = mountWithAudio();
    const runtimeHost = host as typeof host & { EJS_emulator?: unknown };
    const emulator = runtimeHost.EJS_emulator;
    try {
      delete runtimeHost.EJS_emulator;
      game.dispatchEvent(new Event("touchend"));
      expect(audio.resume).not.toHaveBeenCalled();
      runtimeHost.EJS_emulator = emulator;
      game.dispatchEvent(new Event("touchend"));
      expect(audio.state).toBe("running");
    } finally { dispose(); }
  });
});
