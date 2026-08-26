import { describe, expect, it, vi } from "vitest";
import {
  ResumeCoordinator,
  type CheckpointTransport,
  type ResumableGameManager,
} from "./resume-coordinator";

const resumePlan = {
  captureUrl: "/api/games/game-one/checkpoints?session=session-one",
  checkpoints: [
    {
      id: "checkpoint-new",
      generation: 2,
      status: "candidate" as const,
      capturedFrame: 240,
      stateUrl: "/new.state",
      verifyUrl: "/new/verified",
      rejectUrl: "/new/failed",
    },
    {
      id: "checkpoint-good",
      generation: 1,
      status: "verified" as const,
      capturedFrame: 120,
      stateUrl: "/good.state",
      verifyUrl: "/good/verified",
      rejectUrl: "/good/failed",
    },
  ],
};

describe("Resume Coordinator module interface", () => {
  it("does not promote a checkpoint that advances briefly and then freezes", async () => {
    const rejected: string[] = [];
    const verified: string[] = [];
    const transport: CheckpointTransport = {
      capture: vi.fn(),
      fetchState: async (checkpoint) => new Uint8Array([checkpoint.generation]),
      verify: async (checkpoint) => { verified.push(checkpoint.id); },
      reject: async (checkpoint) => { rejected.push(checkpoint.id); },
    };
    let frame = 1;
    let activeGeneration = 0;
    let framesSinceLoad = 0;
    const gameManager: ResumableGameManager = {
      getFrameNum: () => frame,
      getState: () => new Uint8Array([9]),
      loadState: (state) => {
        activeGeneration = state[0];
        framesSinceLoad = 0;
        frame = state[0] === 2 ? 240 : 120;
      },
      restart: vi.fn(() => {
        activeGeneration = 0;
        framesSinceLoad = 0;
        frame = 1;
      }),
    };
    const scheduleFrame = (callback: FrameRequestCallback) => {
      queueMicrotask(() => {
        framesSinceLoad += 1;
        // The newest generation looks alive for the coordinator's current
        // two-sample probe, then reproduces the observed frozen resume. The
        // older generation remains healthy and should be selected instead.
        if (activeGeneration !== 2 || framesSinceLoad <= 2) frame += 1;
        callback(0);
      });
      return 1;
    };
    const coordinator = new ResumeCoordinator(transport, scheduleFrame, 6, 2);

    await expect(coordinator.restore(resumePlan, () => gameManager)).resolves.toEqual({
      status: "restored",
      checkpointId: "checkpoint-good",
      generation: 1,
    });
    expect(rejected).toEqual(["checkpoint-new"]);
    expect(verified).toEqual(["checkpoint-good"]);
  });

  it("rejects a checkpoint that freezes the emulator and rolls back to the prior generation", async () => {
    const rejected: string[] = [];
    const verified: string[] = [];
    const transport: CheckpointTransport = {
      capture: vi.fn(),
      fetchState: async (checkpoint) => new Uint8Array([checkpoint.generation]),
      verify: async (checkpoint) => { verified.push(checkpoint.id); },
      reject: async (checkpoint) => { rejected.push(checkpoint.id); },
    };
    let frame = 1;
    let coreHealthy = true;
    const gameManager: ResumableGameManager = {
      getFrameNum: () => frame,
      getState: () => new Uint8Array([9]),
      loadState: (state) => {
        // Generation two reproduces a semantically bad load: the call appears
        // to succeed, but poisons the running core. A good older state cannot
        // recover that core until the adapter performs a clean restart.
        if (state[0] === 2) coreHealthy = false;
        frame = coreHealthy ? 120 : 1;
      },
      restart: vi.fn(() => {
        coreHealthy = true;
        frame = 1;
      }),
    };
    const scheduleFrame = (callback: FrameRequestCallback) => {
      queueMicrotask(() => {
        if (coreHealthy) frame += 1;
        callback(0);
      });
      return 1;
    };
    const coordinator = new ResumeCoordinator(transport, scheduleFrame, 4, 2);

    await expect(coordinator.restore(resumePlan, () => gameManager)).resolves.toEqual({
      status: "restored",
      checkpointId: "checkpoint-good",
      generation: 1,
    });
    expect(rejected).toEqual(["checkpoint-new"]);
    expect(verified).toEqual(["checkpoint-good"]);
    expect(gameManager.restart).toHaveBeenCalledOnce();
  });

  it("captures an immutable state copy with its emulated frame", async () => {
    let state = new Uint8Array([1, 2, 3]);
    let frame = 321;
    const capture = vi.fn<CheckpointTransport["capture"]>(async () => undefined);
    const transport: CheckpointTransport = {
      capture,
      fetchState: vi.fn(),
      verify: vi.fn(),
      reject: vi.fn(),
    };
    const coordinator = new ResumeCoordinator(transport, (callback) => {
      queueMicrotask(() => {
        frame += 1;
        callback(0);
      });
      return 1;
    }, 6, 2);

    await coordinator.capture(resumePlan, {
      getFrameNum: () => frame,
      getState: () => state,
      loadState: vi.fn(),
    });
    state[0] = 9;

    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0][0]).toBe(resumePlan.captureUrl);
    expect(capture.mock.calls[0][1]).toEqual(new Uint8Array([1, 2, 3]));
    expect(capture.mock.calls[0][2]).toBe(324);
  });

  it("refuses to replace a good checkpoint when the current core is frozen", async () => {
    const capture = vi.fn<CheckpointTransport["capture"]>(async () => undefined);
    const coordinator = new ResumeCoordinator({
      capture,
      fetchState: vi.fn(),
      verify: vi.fn(),
      reject: vi.fn(),
    }, (callback) => {
      queueMicrotask(() => callback(0));
      return 1;
    }, 4, 2);

    await expect(coordinator.capture(resumePlan, {
      getFrameNum: () => 88,
      getState: () => new Uint8Array([1, 2, 3]),
      loadState: vi.fn(),
    })).rejects.toThrow("stopped advancing");
    expect(capture).not.toHaveBeenCalled();
  });

  it("captures a deliberately paused game without treating it as a frozen core", async () => {
    const capture = vi.fn<CheckpointTransport["capture"]>(async () => undefined);
    const coordinator = new ResumeCoordinator({
      capture,
      fetchState: vi.fn(),
      verify: vi.fn(),
      reject: vi.fn(),
    });

    await expect(coordinator.capture(resumePlan, {
      getFrameNum: () => 88,
      getState: () => new Uint8Array([1, 2, 3]),
      loadState: vi.fn(),
    }, () => true)).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledWith(resumePlan.captureUrl, new Uint8Array([1, 2, 3]), 88);
  });
});
