import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PlaybackExitCoordinator,
  InitialStateRestorer,
  PlaybackSaveSession,
  controllerMappingFor,
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

  it("uses only keyboard-like events for the Apple TV Remote compatibility preset", () => {
    expect(controllerMappingFor("apple-tv-remote")[0][8]).toEqual({ value: "enter" });
    expect(Object.values(controllerMappingFor("apple-tv-remote")[0]).every((binding) => binding.value2 === undefined)).toBe(true);
  });
});

describe("player lifecycle", () => {
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

describe("automatic progress capture", () => {
  it("restores the server checkpoint only once when the emulator reports start again", () => {
    const loadState = vi.fn();
    const restorer = new InitialStateRestorer(new Uint8Array([1, 2, 3]));

    expect(restorer.restore({ loadState })).toBe(true);
    expect(restorer.restore({ loadState })).toBe(false);
    expect(loadState).toHaveBeenCalledOnce();
  });

  it("waits for server persistence and reports a completed save", async () => {
    const order: string[] = [];
    const session = new PlaybackSaveSession(async (state) => {
      order.push(`persist:${state.byteLength}`);
    }, (status) => order.push(status));

    await session.save(new Uint8Array([1, 2, 3, 4]));

    expect(order).toEqual(["syncing", "persist:4", "saved"]);
  });

  it("reports a failed sync and still rejects to the leave workflow", async () => {
    const statuses: string[] = [];
    const session = new PlaybackSaveSession(async () => {
      throw new Error("offline");
    }, (status) => statuses.push(status));

    await expect(session.save(new Uint8Array([1]))).rejects.toThrow("offline");
    expect(statuses).toEqual(["syncing", "error"]);
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
});
