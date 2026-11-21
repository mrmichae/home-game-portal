import Foundation

public enum CheckpointSyncState: String, Sendable {
    case idle, restoring, running, saving, saved, queued, conflict, failed
}

public actor CheckpointCoordinator {
    public private(set) var state: CheckpointSyncState = .idle
    private let outbox: CheckpointOutbox
    private var periodicTask: Task<Void, Never>?

    public init(outbox: CheckpointOutbox) {
        self.outbox = outbox
    }

    deinit { periodicTask?.cancel() }

    public func beginPeriodicCapture(
        adapter: any NESPlaybackAdapter,
        session: PortalSession,
        serverID: String,
        manifest: PlaybackLeaseManifest,
        leaseRevision: @escaping @Sendable () async -> Int,
        frame: @escaping @Sendable () async -> Int
    ) {
        periodicTask?.cancel()
        state = .running
        periodicTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { break }
                await capture(
                    adapter: adapter,
                    session: session,
                    serverID: serverID,
                    manifest: manifest,
                    leaseRevision: await leaseRevision(),
                    frame: await frame()
                )
            }
        }
    }

    public func capture(
        adapter: any NESPlaybackAdapter,
        session: PortalSession,
        serverID: String,
        manifest: PlaybackLeaseManifest,
        leaseRevision: Int,
        frame: Int
    ) async {
        state = .saving
        do {
            let data = try await adapter.captureState()
            do {
                try await session.uploadCheckpoint(
                    path: manifest.checkpointUpload.url,
                    state: data,
                    capturedFrame: frame,
                    leaseRevision: leaseRevision
                )
                state = .saved
            } catch {
                _ = try await outbox.enqueue(
                    state: data,
                    serverID: serverID,
                    leaseID: manifest.lease.id,
                    leaseRevision: leaseRevision,
                    uploadPath: manifest.checkpointUpload.url,
                    capturedFrame: frame
                )
                state = .queued
            }
        } catch {
            state = .failed
        }
    }

    public func stop() {
        periodicTask?.cancel()
        periodicTask = nil
    }

    public func flushOutbox(session: PortalSession, serverID: String) async {
        for item in await outbox.all() where item.serverID == serverID {
            do {
                try await session.uploadCheckpoint(
                    path: item.uploadPath,
                    state: try await outbox.data(for: item),
                    capturedFrame: item.capturedFrame,
                    leaseRevision: item.leaseRevision
                )
                try await outbox.acknowledge(item.id)
                state = .saved
            } catch let PortalSessionError.api(code, _, _) where code == "lease_stale" || code == "lease_unavailable" {
                state = .conflict
                return
            } catch {
                state = .queued
                return
            }
        }
    }
}
