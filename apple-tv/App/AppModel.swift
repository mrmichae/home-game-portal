import Foundation
import Combine
import PortalCore

@MainActor
final class AppModel: ObservableObject {
    enum Destination: String, CaseIterable, Identifiable {
        case browse = "Browse"
        case collections = "Collections"
        case library = "My Library"
        case search = "Search"
        case settings = "Settings"

        var id: String { rawValue }
    }

    enum LibrarySort: String, CaseIterable, Identifiable {
        case title = "Title"
        case releaseYear = "Release Year"
        case recentlyPlayed = "Recently Played"
        case recentlyAdded = "Recently Added"

        var id: String { rawValue }
    }

    enum Route: Equatable {
        case loading
        case servers
        case pairing
        case profiles
        case catalog
        case player
        case playbackConflict
        case failure(String)
    }

    @Published var route: Route = .loading
    @Published var servers: [PortalServerDescriptor] = []
    @Published var manualEndpoint = ""
    @Published var pairingCode = ""
    @Published var pairingMessage = "Approve this code in the Portal web administration screen."
    @Published var profiles: [PlayerProfile] = []
    @Published var games: [GameSummary] = []
    @Published var presentation = CatalogPresentation.empty
    @Published var selectedProfile: PlayerProfile?
    @Published var destination: Destination = .browse
    @Published var librarySort: LibrarySort = .title
    @Published var searchText = ""
    @Published var system: SystemCapabilities?
    @Published var statusMessage: String?
    @Published var activeGame: GameSummary?
    @Published var playbackManifest: PlaybackLeaseManifest?
    @Published var downloadedROM: Data?
    @Published var resumeState: Data?
    @Published var resumeCheckpointID: String?
    @Published var playbackLeaseRevision: Int?
    @Published var conflictDeviceName = "another device"
    @Published var conflictLeaseID: String?
    @Published var conflictGame: GameSummary?

    let discovery = PortalDiscovery()
    let controllers = ControllerCoordinator()
    private let serverStore = ServerStore()
    private let credentials = CredentialStore()
    private var session: PortalSession?
    private var activeServer: PortalServerDescriptor?
    private var pairingTask: Task<Void, Never>?
    private var leaseTask: Task<Void, Never>?

    func bootstrap() async {
        servers = await serverStore.load()
        discovery.start()
        guard let active = await serverStore.active() else {
            route = .servers
            return
        }
        await connect(to: active)
    }

    func addManualServer() async {
        do {
            let endpoint = try PortalEndpoint.normalize(manualEndpoint)
            await probeAndPair(name: endpoint.host ?? "Portal Server", endpoint: endpoint)
        } catch {
            route = .failure(error.localizedDescription)
        }
    }

    func addDiscoveredServer(_ portal: DiscoveredPortal) async {
        await probeAndPair(name: portal.name, endpoint: portal.endpoint)
    }

    func connect(to descriptor: PortalServerDescriptor) async {
        do {
            guard let account = descriptor.credentialAccount else {
                await probeAndPair(name: descriptor.name, endpoint: descriptor.endpoint)
                return
            }
            let credential = try credentials.load(account: account)
            let candidate = PortalSession(endpoint: descriptor.endpoint, credential: credential)
            system = try await candidate.system()
            session = candidate
            activeServer = descriptor
            await serverStore.select(descriptor.id)
            profiles = try await candidate.profiles()
            route = .profiles
        } catch let PortalSessionError.api(code, _, _) where code == "device_revoked" || code == "device_unauthorized" {
            await probeAndPair(name: descriptor.name, endpoint: descriptor.endpoint)
        } catch {
            route = .failure(error.localizedDescription)
        }
    }

    func takeOverPlayback() async {
        guard let session, let leaseID = conflictLeaseID, let game = conflictGame else { return }
        do {
            let manifest = try await session.takeover(leaseID: leaseID)
            let rom = try await session.download(path: manifest.gameFile.downloadUrl, expectedSHA256: manifest.gameFile.sha256)
            try validateINES(rom)
            if let checkpoint = manifest.checkpoints.first {
                resumeState = try? await session.download(path: checkpoint.downloadUrl, expectedSHA256: checkpoint.stateSha256)
                resumeCheckpointID = resumeState == nil ? nil : checkpoint.id
            }
            activeGame = game
            playbackManifest = manifest
            playbackLeaseRevision = manifest.lease.revision
            downloadedROM = rom
            conflictLeaseID = nil
            conflictGame = nil
            route = .player
            startLeaseRenewal(session: session, manifest: manifest)
        } catch {
            route = .failure(error.localizedDescription)
        }
    }

    func cancelTakeover() {
        conflictLeaseID = nil
        conflictGame = nil
        route = .catalog
    }

    func selectProfile(_ profile: PlayerProfile) async {
        guard let session else { return }
        do {
            await session.selectProfile(profile.key)
            selectedProfile = profile
            try await reloadCatalog()
            destination = .browse
            route = .catalog
        } catch {
            route = .failure(error.localizedDescription)
        }
    }

    func launchGame(_ game: GameSummary, intent: String) async {
        guard let session else { return }
        guard controllers.hasRequiredController else {
            route = .failure("Connect a Bluetooth game controller before starting a Game. The Siri Remote is for navigation only.")
            return
        }
        do {
            let manifest = try await session.beginPlayback(gameID: game.id, intent: intent)
            let rom = try await session.download(path: manifest.gameFile.downloadUrl, expectedSHA256: manifest.gameFile.sha256)
            try validateINES(rom)
            if intent == "resume", let checkpoint = manifest.checkpoints.first {
                do {
                    resumeState = try await session.download(path: checkpoint.downloadUrl, expectedSHA256: checkpoint.stateSha256)
                    resumeCheckpointID = checkpoint.id
                } catch {
                    try? await session.recordRestoreAttempt(
                        checkpointID: checkpoint.id,
                        outcome: "failed",
                        reason: error.localizedDescription
                    )
                    resumeState = nil
                    resumeCheckpointID = nil
                }
            } else {
                resumeState = nil
                resumeCheckpointID = nil
            }
            activeGame = game
            playbackManifest = manifest
            playbackLeaseRevision = manifest.lease.revision
            downloadedROM = rom
            route = .player
            startLeaseRenewal(session: session, manifest: manifest)
        } catch let PortalSessionError.playbackConflict(leaseID, activeDeviceName) {
            conflictLeaseID = leaseID
            conflictDeviceName = activeDeviceName
            conflictGame = game
            route = .playbackConflict
        } catch {
            route = .failure(error.localizedDescription)
        }
    }

    func leavePlayer() async {
        leaseTask?.cancel()
        leaseTask = nil
        guard let session, let lease = playbackManifest?.lease else {
            route = .catalog
            return
        }
        try? await session.release(leaseID: lease.id, revision: playbackLeaseRevision ?? lease.revision)
        playbackManifest = nil
        downloadedROM = nil
        resumeState = nil
        resumeCheckpointID = nil
        playbackLeaseRevision = nil
        activeGame = nil
        route = .catalog
    }

    func recordRestoreSucceeded(frame: Int) async {
        guard let session, let checkpointID = resumeCheckpointID else { return }
        try? await session.recordRestoreAttempt(
            checkpointID: checkpointID,
            outcome: "verified",
            observedFrame: frame
        )
    }

    func recordRestoreFailed(reason: String) async {
        guard let session, let checkpointID = resumeCheckpointID else { return }
        try? await session.recordRestoreAttempt(
            checkpointID: checkpointID,
            outcome: "failed",
            reason: reason
        )
    }

    func publishCheckpoint(_ state: Data, frame: Int) async {
        guard let session,
              let serverID = activeServer?.serverID,
              let manifest = playbackManifest,
              let revision = playbackLeaseRevision
        else { return }
        do {
            try await session.uploadCheckpoint(
                path: manifest.checkpointUpload.url,
                state: state,
                capturedFrame: frame,
                leaseRevision: revision
            )
        } catch {
            do {
                let outbox = try CheckpointOutbox()
                _ = try await outbox.enqueue(
                    state: state,
                    serverID: serverID,
                    leaseID: manifest.lease.id,
                    leaseRevision: revision,
                    uploadPath: manifest.checkpointUpload.url,
                    capturedFrame: frame
                )
            } catch {
                route = .failure("Progress could not be saved locally. Keep the app open and try again.")
            }
        }
    }

    func showServers() {
        pairingTask?.cancel()
        selectedProfile = nil
        destination = .browse
        route = .servers
    }

    func reloadCatalog() async throws {
        guard let session else { return }
        let envelope = try await session.catalog()
        games = envelope.shelf.games
        presentation = envelope.presentation
    }

    func toggleFavorite(_ game: GameSummary) async {
        guard let session else { return }
        updateGame(game, favorite: !game.isFavorite)
        do {
            _ = try await session.setFavorite(gameID: game.id, favorite: !game.isFavorite)
            try await reloadCatalog()
        } catch {
            try? await reloadCatalog()
            statusMessage = error.localizedDescription
        }
    }

    func dismissContinuePlaying(_ game: GameSummary) async {
        guard let session else { return }
        do {
            _ = try await session.dismissContinuePlaying(gameID: game.id)
            try await reloadCatalog()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func forgetServer(_ server: PortalServerDescriptor) async {
        if let account = server.credentialAccount { credentials.remove(account: account) }
        do {
            try await serverStore.forget(server.id)
            servers = await serverStore.load()
            if activeServer?.id == server.id {
                activeServer = nil
                session = nil
                system = nil
                profiles = []
                games = []
                presentation = .empty
            }
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func testConnection(_ server: PortalServerDescriptor) async {
        do {
            let capabilities = try await PortalSession(endpoint: server.endpoint).system()
            statusMessage = "Connected to \(capabilities.serverName) · API \(capabilities.apiVersions.joined(separator: ", "))"
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func updateServer(_ server: PortalServerDescriptor, name: String, address: String) async -> Bool {
        do {
            let endpoint = try PortalEndpoint.normalize(address)
            let capabilities = try await PortalSession(endpoint: endpoint).system()
            if let expected = server.serverID, expected != capabilities.serverId {
                throw PortalSessionError.api(
                    code: "server_identity_changed",
                    message: "That address belongs to a different Portal Server.",
                    retryable: false
                )
            }
            var updated = server
            updated.serverID = capabilities.serverId
            updated.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? capabilities.serverName
                : name.trimmingCharacters(in: .whitespacesAndNewlines)
            updated.endpoint = endpoint
            try await serverStore.save(updated)
            servers = await serverStore.load()
            if activeServer?.id == server.id { activeServer = updated }
            statusMessage = "Saved \(updated.name)."
            return true
        } catch {
            statusMessage = error.localizedDescription
            return false
        }
    }

    func artworkURL(for game: GameSummary) -> URL? {
        guard let endpoint = activeServer?.endpoint else { return nil }
        return URL(string: game.coverUrl, relativeTo: endpoint)?.absoluteURL
    }

    private func probeAndPair(name: String, endpoint: URL) async {
        do {
            let candidate = PortalSession(endpoint: endpoint)
            let system = try await candidate.system()
            self.system = system
            let credential = UUID().uuidString + UUID().uuidString
            let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
            let pairing = try await candidate.createPairing(
                deviceName: "Apple TV",
                appVersion: appVersion,
                credential: credential
            )
            pairingCode = pairing.code
            pairingMessage = "Approve this code in \(system.serverName)’s web administration screen."
            route = .pairing
            pairingTask?.cancel()
            pairingTask = Task { [weak self] in
                while !Task.isCancelled {
                    do {
                        try await Task.sleep(for: .seconds(2))
                        let status = try await candidate.pairingStatus(id: pairing.id, pollSecret: pairing.pollSecret)
                        switch status.state {
                        case "approved":
                            guard let self else { return }
                            let account = "server.\(system.serverId)"
                            try self.credentials.save(credential, account: account)
                            var descriptor = PortalServerDescriptor(
                                serverID: system.serverId,
                                name: system.serverName.isEmpty ? name : system.serverName,
                                endpoint: endpoint,
                                credentialAccount: account
                            )
                            if let existing = self.servers.first(where: { $0.serverID == system.serverId }) {
                                descriptor = PortalServerDescriptor(
                                    id: existing.id,
                                    serverID: system.serverId,
                                    name: system.serverName,
                                    endpoint: endpoint,
                                    credentialAccount: account
                                )
                            }
                            try await self.serverStore.save(descriptor)
                            await candidate.setCredential(credential)
                            self.session = candidate
                            self.activeServer = descriptor
                            self.servers = await self.serverStore.load()
                            self.profiles = try await candidate.profiles()
                            self.route = .profiles
                            return
                        case "denied", "expired":
                            self?.route = .failure("Pairing was \(status.state). Return to Servers and try again.")
                            return
                        default:
                            continue
                        }
                    } catch is CancellationError {
                        return
                    } catch {
                        self?.pairingMessage = "Waiting for the Portal Server… \(error.localizedDescription)"
                    }
                }
            }
        } catch {
            route = .failure(error.localizedDescription)
        }
    }

    private func updateGame(_ game: GameSummary, favorite: Bool) {
        guard let index = games.firstIndex(where: { $0.id == game.id }) else { return }
        games[index] = games[index].withFavorite(favorite)
    }

    private func startLeaseRenewal(session: PortalSession, manifest: PlaybackLeaseManifest) {
        leaseTask?.cancel()
        leaseTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(manifest.lease.renewalIntervalSeconds))
                    guard let self, let revision = self.playbackLeaseRevision else { return }
                    let renewed = try await session.renew(leaseID: manifest.lease.id, revision: revision)
                    self.playbackLeaseRevision = renewed.revision
                } catch is CancellationError {
                    return
                } catch {
                    self?.route = .failure("Playback lost its server lease. Your latest local progress will be kept for conflict recovery.")
                    return
                }
            }
        }
    }
}
