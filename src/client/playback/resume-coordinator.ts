import type { ResumeCheckpoint, ResumePlan } from "../../domain/types";

export interface ResumableGameManager {
  getState: () => Uint8Array;
  getFrameNum: () => number;
  loadState: (state: Uint8Array) => void;
  restart?: () => void;
}

export interface CheckpointTransport {
  capture(captureUrl: string, state: Uint8Array, capturedFrame: number): Promise<void>;
  fetchState(checkpoint: ResumeCheckpoint): Promise<Uint8Array>;
  verify(checkpoint: ResumeCheckpoint, observedFrame: number): Promise<void>;
  reject(checkpoint: ResumeCheckpoint, reason: string): Promise<void>;
}

export type RestoreResult =
  | { status: "none" }
  | { status: "restored"; checkpointId: string; generation: number }
  | { status: "fresh" };

/**
 * Owns the entire web resume policy: immutable capture, ordered restore,
 * core-progress validation, server acknowledgement, and rollback. The
 * Playback Adapter only supplies an emulator-shaped game manager.
 */
export class ResumeCoordinator {
  constructor(
    private readonly transport: CheckpointTransport = new HttpCheckpointTransport(),
    private readonly scheduleFrame: (callback: FrameRequestCallback) => number = (callback) => window.requestAnimationFrame(callback),
    private readonly validationAttempts = 120,
  ) {}

  async capture(plan: ResumePlan, gameManager: ResumableGameManager): Promise<void> {
    const capturedFrame = gameManager.getFrameNum();
    const state = gameManager.getState();
    if (!state.byteLength) throw new Error("The game did not provide checkpoint data.");
    if (!Number.isSafeInteger(capturedFrame) || capturedFrame < 0) throw new Error("The game did not provide a checkpoint frame.");
    await this.transport.capture(plan.captureUrl, state.slice(), capturedFrame);
  }

  async restore(
    plan: ResumePlan,
    getGameManager: () => ResumableGameManager | undefined,
    isCancelled: () => boolean = () => false,
  ): Promise<RestoreResult> {
    if (!plan.checkpoints.length) return { status: "none" };
    const gameManager = await this.waitForGameManager(getGameManager, isCancelled);
    if (!gameManager) return { status: "fresh" };

    for (const [index, checkpoint] of plan.checkpoints.entries()) {
      if (isCancelled()) return { status: "fresh" };
      try {
        const state = await this.transport.fetchState(checkpoint);
        if (!state.byteLength) throw new Error("Checkpoint data is empty.");
        gameManager.loadState(state);
        const observedFrame = await this.waitForCoreProgress(gameManager, isCancelled);
        if (observedFrame === null) throw new Error("The emulator stopped advancing after loading the checkpoint.");
        // Verification is an acknowledgement, not part of the successful load.
        // A temporary network failure must not discard progress that is already running.
        await this.transport.verify(checkpoint, observedFrame).catch(() => undefined);
        return { status: "restored", checkpointId: checkpoint.id, generation: checkpoint.generation };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Checkpoint could not be restored.";
        await this.transport.reject(checkpoint, reason).catch(() => undefined);
        // A semantically bad state can leave the core unable to advance. Give
        // the next rollback generation a clean runtime instead of loading it
        // into the already-poisoned core.
        if (index < plan.checkpoints.length - 1) {
          await this.restartCore(gameManager, isCancelled);
        }
      }
    }

    await this.restartCore(gameManager, isCancelled);
    return { status: "fresh" };
  }

  private async restartCore(
    gameManager: ResumableGameManager,
    isCancelled: () => boolean,
  ): Promise<void> {
    if (isCancelled()) return;
    try {
      gameManager.restart?.();
    } catch {
      // The next load attempt will provide the authoritative result.
    }
    await this.nextFrame();
  }

  private async waitForGameManager(
    getGameManager: () => ResumableGameManager | undefined,
    isCancelled: () => boolean,
  ): Promise<ResumableGameManager | null> {
    for (let attempt = 0; attempt < this.validationAttempts; attempt += 1) {
      if (isCancelled()) return null;
      const gameManager = getGameManager();
      try {
        if (gameManager && gameManager.getFrameNum() >= 1) return gameManager;
      } catch {
        // The runtime exists before its state interface is ready. Try next frame.
      }
      await this.nextFrame();
    }
    return null;
  }

  private async waitForCoreProgress(
    gameManager: ResumableGameManager,
    isCancelled: () => boolean,
  ): Promise<number | null> {
    let priorFrame: number | null = null;
    for (let attempt = 0; attempt < this.validationAttempts; attempt += 1) {
      if (isCancelled()) return null;
      await this.nextFrame();
      try {
        const observedFrame = gameManager.getFrameNum();
        if (priorFrame !== null && observedFrame > priorFrame) return observedFrame;
        priorFrame = observedFrame;
      } catch {
        // A failed state can briefly make the core unavailable. Allow rollback.
      }
    }
    return null;
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => this.scheduleFrame(() => resolve()));
  }
}

export class HttpCheckpointTransport implements CheckpointTransport {
  async capture(captureUrl: string, state: Uint8Array, capturedFrame: number): Promise<void> {
    const response = await fetch(captureUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Captured-Frame": String(capturedFrame),
      },
      body: state.slice().buffer as ArrayBuffer,
    });
    if (!response.ok) throw new Error("Checkpoint sync failed.");
  }

  async fetchState(checkpoint: ResumeCheckpoint): Promise<Uint8Array> {
    const response = await fetch(checkpoint.stateUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Checkpoint data is unavailable.");
    return new Uint8Array(await response.arrayBuffer());
  }

  async verify(checkpoint: ResumeCheckpoint, observedFrame: number): Promise<void> {
    const response = await fetch(checkpoint.verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observedFrame }),
    });
    if (!response.ok) throw new Error("Checkpoint verification could not be recorded.");
  }

  async reject(checkpoint: ResumeCheckpoint, reason: string): Promise<void> {
    const response = await fetch(checkpoint.rejectUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) throw new Error("Checkpoint rollback could not be recorded.");
  }
}
