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
    let frozen = false;
    const gameManager: ResumableGameManager = {
      getFrameNum: () => frame,
      getState: () => new Uint8Array([9]),
      loadState: (state) => {
        // Generation two reproduces a semantically bad load: the call appears
        // to succeed, but the emulator stops advancing.
        frozen = state[0] === 2;
        frame = frozen ? 1 : 120;
      },
      restart: vi.fn(),
    };
    const scheduleFrame = (callback: FrameRequestCallback) => {
      queueMicrotask(() => {
        if (!frozen) frame += 1;
        callback(0);
      });
      return 1;
    };
    const coordinator = new ResumeCoordinator(transport, scheduleFrame, 4);

    await expect(coordinator.restore(resumePlan, () => gameManager)).resolves.toEqual({
      status: "restored",
      checkpointId: "checkpoint-good",
      generation: 1,
    });
    expect(rejected).toEqual(["checkpoint-new"]);
    expect(verified).toEqual(["checkpoint-good"]);
    expect(gameManager.restart).not.toHaveBeenCalled();
  });

  it("captures an immutable state copy with its emulated frame", async () => {
    let state = new Uint8Array([1, 2, 3]);
    const capture = vi.fn<CheckpointTransport["capture"]>(async () => undefined);
    const transport: CheckpointTransport = {
      capture,
      fetchState: vi.fn(),
      verify: vi.fn(),
      reject: vi.fn(),
    };
    const coordinator = new ResumeCoordinator(transport, (callback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });

    await coordinator.capture(resumePlan, {
      getFrameNum: () => 321,
      getState: () => state,
      loadState: vi.fn(),
    });
    state[0] = 9;

    expect(capture).toHaveBeenCalledOnce();
    expect(capture.mock.calls[0][0]).toBe(resumePlan.captureUrl);
    expect(capture.mock.calls[0][1]).toEqual(new Uint8Array([1, 2, 3]));
    expect(capture.mock.calls[0][2]).toBe(321);
  });
});
