import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PlaybackExitCoordinator,
  controllerMappingFor,
  createCheckpointGatedStartHandler,
  disableImplicitCoreRestart,
  fetchGameFile,
  isBenignRuntimeRejection,
  resolveFceummRuntimeFile,
  selectRuntimeProfile,
} from "./emulator-js-adapter";

describe("FCEUmm runtime asset resolution", () => {
  it("bypasses an invalid archive-worker result for the WebAssembly binary", () => {
    const brokenWorkerLocation = vi.fn(() => "blob:undefined");

    expect(resolveFceummRuntimeFile("fceumm_libretro.wasm", "", brokenWorkerLocation)).toBe(
      "/emulatorjs/cores/fceumm_libretro.wasm",
    );
    expect(brokenWorkerLocation).not.toHaveBeenCalled();
  });

  it("ships a valid WebAssembly module at the resolved path", async () => {
    const wasm = await readFile(path.resolve("public/emulatorjs/cores/fceumm_libretro.wasm"));
    expect([...wasm.subarray(0, 8)]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  });

  it("ships the pinned Snes9x WebAssembly modules", async () => {
    const [singleThreaded, threaded] = await Promise.all([
      readFile(path.resolve("public/emulatorjs/cores/snes9x_libretro.wasm")),
      readFile(path.resolve("public/emulatorjs/cores/snes9x_thread_libretro.wasm")),
    ]);
    expect([...singleThreaded.subarray(0, 8)]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    expect([...threaded.subarray(0, 8)]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  });
});

describe("server Game File preparation", () => {
  it("downloads and validates an iNES file before EmulatorJS starts", async () => {
    const bytes = new Uint8Array([0x4e, 0x45, 0x53, 0x1a, ...new Array(12).fill(0), 1, 2, 3]);
    const fetcher = vi.fn(async () => new Response(bytes));

    const file = await fetchGameFile("/api/playback/files/session", new AbortController().signal, "nes", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/playback/files/session", expect.objectContaining({ cache: "no-store" }));
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it("turns an unavailable or invalid launch response into a useful player error", async () => {
    await expect(fetchGameFile("/missing", new AbortController().signal, "nes", async () => new Response(null, { status: 404 })))
      .rejects.toThrow("could not be read from the server");
    await expect(fetchGameFile("/invalid", new AbortController().signal, "nes", async () => new Response(new Uint8Array([1, 2, 3]))))
      .rejects.toThrow("valid NES game");
  });

  it("accepts a plausible Super Nintendo cartridge image", async () => {
    const bytes = snesBytes();
    const file = await fetchGameFile(
      "/api/playback/files/snes-session",
      new AbortController().signal,
      "snes",
      async () => new Response(bytes.slice().buffer as ArrayBuffer),
    );

    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });
});

describe("controller preset translation", () => {
  it("keeps keyboard directions and NES face buttons internal to the adapter", () => {
    const controls = controllerMappingFor("keyboard");
    expect(controls[0]).toMatchObject({
      0: { value: "x" },
      3: { value: "enter" },
      4: { value: "up arrow" },
      8: { value: "z" },
    });
    expect(controls).toMatchObject({ 1: {}, 2: {}, 3: {} });
  });

  it("adds standard browser gamepad codes for Switch-style controllers", () => {
    expect(controllerMappingFor("switch-pro")[0]).toMatchObject({
      0: { value2: "BUTTON_2" },
      3: { value2: "START" },
      4: { value2: "DPAD_UP" },
      8: { value2: "BUTTON_1" },
    });
    expect(controllerMappingFor("joy-con")).toEqual(controllerMappingFor("switch-pro"));
  });

  it("adds the extra SNES face and shoulder buttons without changing NES mappings", () => {
    expect(controllerMappingFor("keyboard", "snes")[0]).toMatchObject({
      1: { value: "a" },
      9: { value: "s" },
      10: { value: "q" },
      11: { value: "w" },
    });
    expect(controllerMappingFor("switch-pro", "snes")[0]).toMatchObject({
      1: { value2: "BUTTON_4" },
      9: { value2: "BUTTON_3" },
      10: { value2: "LEFT_TOP_SHOULDER" },
      11: { value2: "RIGHT_TOP_SHOULDER" },
    });
    expect(controllerMappingFor("keyboard", "nes")[0][11]).toBeUndefined();
  });

  it("uses only keyboard-like events for the Apple TV Remote compatibility preset", () => {
    expect(controllerMappingFor("apple-tv-remote")[0][8]).toEqual({ value: "enter" });
    expect(Object.values(controllerMappingFor("apple-tv-remote")[0]).every((binding) => binding.value2 === undefined)).toBe(true);
  });
});

describe("player lifecycle", () => {
  it("neutralizes a stale EmulatorJS soft-load timer before a resumed game starts", () => {
    const host = { EJS_softLoad: 30 };

    disableImplicitCoreRestart(host);

    expect(host.EJS_softLoad).toBe(0);
  });

  it("does not treat an unavailable screen wake lock as a playback failure", () => {
    expect(isBenignRuntimeRejection(new DOMException("Wake Lock permission request denied", "NotAllowedError"))).toBe(true);
    expect(isBenignRuntimeRejection(new Error("WebAssembly failed"))).toBe(false);
  });

  it("settles checkpoint restoration before exposing gameplay and ignores repeated start events", async () => {
    let finishRestore: ((result: { status: "restored"; checkpointId: string; generation: number }) => void) | undefined;
    const restore = vi.fn(() => new Promise<{ status: "restored"; checkpointId: string; generation: number }>((resolve) => {
      finishRestore = resolve;
    }));
    const onRestoreResult = vi.fn();
    const onRunning = vi.fn();
    const onRestoreError = vi.fn();
    const handleStart = createCheckpointGatedStartHandler({
      restore,
      onRestoreResult,
      onRestoreError,
      onRunning,
      isDisposed: () => false,
    });

    handleStart();
    handleStart();

    expect(restore).toHaveBeenCalledOnce();
    expect(onRunning).not.toHaveBeenCalled();
    finishRestore?.({ status: "restored", checkpointId: "checkpoint-one", generation: 1 });
    await vi.waitFor(() => expect(onRunning).toHaveBeenCalledOnce());
    expect(onRestoreResult).toHaveBeenCalledWith({ status: "restored", checkpointId: "checkpoint-one", generation: 1 });
    expect(onRestoreError).not.toHaveBeenCalled();
  });

  it("wires the documented EmulatorJS exit callback in the pinned loader", async () => {
    const loader = await readFile(path.resolve("public/emulatorjs/loader.js"), "utf8");
    expect(loader).toContain('window.EJS_emulator.on("exit", window.EJS_onExit)');
  });

  it("does not navigate again when route cleanup shuts down the emulator", () => {
    const navigate = vi.fn();
    const callEvent = vi.fn((event: string) => {
      if (event === "exit") coordinator.handleEmulatorExit();
    });
    const coordinator = new PlaybackExitCoordinator(navigate);

    coordinator.teardown({ callEvent });

    expect(callEvent).toHaveBeenCalledOnce();
    expect(callEvent).toHaveBeenCalledWith("exit");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates once when the emulator Exit control is used", () => {
    const navigate = vi.fn();
    const coordinator = new PlaybackExitCoordinator(navigate);

    coordinator.handleEmulatorExit();
    coordinator.teardown({ callEvent: vi.fn() });

    expect(navigate).toHaveBeenCalledOnce();
  });

  it("contains a core shutdown exception so React can finish changing routes", () => {
    const coordinator = new PlaybackExitCoordinator(vi.fn());
    const consoleWarning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => coordinator.teardown({ callEvent: () => { throw new Error("core abort"); } })).not.toThrow();

    expect(consoleWarning).toHaveBeenCalledOnce();
    consoleWarning.mockRestore();
  });

});

describe("runtime selection", () => {
  it("uses the threaded core only when the page is cross-origin isolated", () => {
    expect(selectRuntimeProfile({ crossOriginIsolated: true, hasSharedArrayBuffer: true })).toMatchObject({
      threaded: true,
      scriptPath: "/emulatorjs/cores/fceumm_thread_libretro.js",
    });
    expect(selectRuntimeProfile({ crossOriginIsolated: false, hasSharedArrayBuffer: true })).toMatchObject({
      threaded: false,
      scriptPath: "/emulatorjs/cores/fceumm_libretro.js",
    });
  });
  it("avoids the threaded WebAssembly runtime in Safari on macOS and iOS", () => {
    const macSafari = {
      crossOriginIsolated: true,
      hasSharedArrayBuffer: true,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
      vendor: "Apple Computer, Inc.",
      platform: "MacIntel",
      maxTouchPoints: 0,
    };
    const iphoneSafari = {
      crossOriginIsolated: true,
      hasSharedArrayBuffer: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
      vendor: "Apple Computer, Inc.",
      platform: "iPhone",
      maxTouchPoints: 5,
    };

    expect(selectRuntimeProfile(macSafari)).toMatchObject({
      threaded: false,
      scriptPath: "/emulatorjs/cores/fceumm_libretro.js",
    });
    expect(selectRuntimeProfile(iphoneSafari)).toMatchObject({
      threaded: false,
      scriptPath: "/emulatorjs/cores/fceumm_libretro.js",
    });
  });

  it("keeps threaded playback for cross-origin-isolated Chromium", () => {
    expect(selectRuntimeProfile({
      crossOriginIsolated: true,
      hasSharedArrayBuffer: true,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      vendor: "Google Inc.",
      platform: "MacIntel",
      maxTouchPoints: 0,
    })).toMatchObject({
      threaded: true,
      scriptPath: "/emulatorjs/cores/fceumm_thread_libretro.js",
    });
  });

  it("selects the matching Snes9x runtime without changing the isolation policy", () => {
    expect(selectRuntimeProfile({ crossOriginIsolated: true, hasSharedArrayBuffer: true }, "snes9x")).toMatchObject({
      threaded: true,
      scriptPath: "/emulatorjs/cores/snes9x_thread_libretro.js",
      wasmPath: "/emulatorjs/cores/snes9x_thread_libretro.wasm",
    });
    expect(selectRuntimeProfile({ crossOriginIsolated: false, hasSharedArrayBuffer: true }, "snes9x")).toMatchObject({
      threaded: false,
      scriptPath: "/emulatorjs/cores/snes9x_libretro.js",
      wasmPath: "/emulatorjs/cores/snes9x_libretro.wasm",
    });
  });
});

function snesBytes(): Uint8Array {
  const bytes = new Uint8Array(0x8000);
  bytes.fill(0xff);
  const title = new TextEncoder().encode("TEST SNES GAME       ");
  bytes.set(title.subarray(0, 21), 0x7fc0);
  bytes[0x7fd5] = 0x20;
  bytes[0x7fd7] = 0x09;
  bytes[0x7fdc] = 0x34;
  bytes[0x7fdd] = 0x12;
  bytes[0x7fde] = 0xcb;
  bytes[0x7fdf] = 0xed;
  bytes[0x7ffc] = 0x00;
  bytes[0x7ffd] = 0x80;
  return bytes;
}
