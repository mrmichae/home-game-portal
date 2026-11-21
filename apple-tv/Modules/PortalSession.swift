import CryptoKit
import Foundation

public actor PortalSession {
    public let endpoint: URL
    private let urlSession: URLSession
    private var credential: String?
    private var profileKey: String?
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    public init(endpoint: URL, credential: String? = nil, urlSession: URLSession = .shared) {
        self.endpoint = endpoint
        self.credential = credential
        self.urlSession = urlSession
    }

    public func selectProfile(_ key: String) {
        profileKey = key
    }

    public func setCredential(_ value: String) {
        credential = value
    }

    public func system() async throws -> SystemCapabilities {
        let value: SystemCapabilities = try await json(path: "/api/v1/system", authenticated: false)
        guard value.apiVersions.contains("1") else { throw PortalSessionError.incompatibleServer }
        return value
    }

    public func createPairing(deviceName: String, appVersion: String, credential: String) async throws -> PairingEnvelope.Pairing {
        struct Input: Encodable { let deviceName: String; let appVersion: String; let credentialDigest: String }
        let digest = SHA256.hash(data: Data(credential.utf8)).map { String(format: "%02x", $0) }.joined()
        let envelope: PairingEnvelope = try await json(
            path: "/api/v1/pairings",
            method: "POST",
            body: Input(deviceName: deviceName, appVersion: appVersion, credentialDigest: digest),
            authenticated: false
        )
        return envelope.pairing
    }

    public func pairingStatus(id: String, pollSecret: String) async throws -> PairingStatusEnvelope.PairingStatus {
        var request = URLRequest(url: try url(path: "/api/v1/pairings/\(id)"))
        request.setValue("Pairing \(pollSecret)", forHTTPHeaderField: "Authorization")
        let envelope: PairingStatusEnvelope = try await execute(request)
        return envelope.pairing
    }

    public func profiles() async throws -> [PlayerProfile] {
        let envelope: ProfilesEnvelope = try await json(path: "/api/v1/profiles")
        return envelope.profiles
    }

    public func catalog() async throws -> CatalogEnvelope {
        try await json(path: try profiled("/api/v1/catalog"))
    }

    public func setFavorite(gameID: String, favorite: Bool) async throws -> GameSummary {
        struct Input: Encodable { let favorite: Bool }
        struct Envelope: Decodable { let game: GameSummary }
        let envelope: Envelope = try await json(
            path: try profiled("/api/v1/games/\(gameID)/favorite"),
            method: "PUT",
            body: Input(favorite: favorite)
        )
        return envelope.game
    }

    public func dismissContinuePlaying(gameID: String) async throws -> GameSummary {
        struct Envelope: Decodable { let game: GameSummary }
        var request = try authorizedRequest(path: try profiled("/api/v1/games/\(gameID)/continue-playing"))
        request.httpMethod = "DELETE"
        let envelope: Envelope = try await execute(request)
        return envelope.game
    }

    public func beginPlayback(gameID: String, intent: String) async throws -> PlaybackLeaseManifest {
        struct Input: Encodable { let intent: String }
        return try await json(
            path: try profiled("/api/v1/games/\(gameID)/playback-leases"),
            method: "POST",
            body: Input(intent: intent)
        )
    }

    public func download(path: String, expectedSHA256: String? = nil) async throws -> Data {
        let request = try authorizedRequest(path: path)
        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
        if let expectedSHA256 {
            let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard actual == expectedSHA256 else { throw PortalSessionError.invalidResponse }
        }
        return data
    }

    public func renew(leaseID: String, revision: Int) async throws -> PlaybackLeaseManifest.Lease {
        struct Input: Encodable { let revision: Int }
        struct Envelope: Decodable { let lease: PlaybackLeaseManifest.Lease }
        let envelope: Envelope = try await json(
            path: "/api/v1/playback-leases/\(leaseID)/renew",
            method: "POST",
            body: Input(revision: revision)
        )
        return envelope.lease
    }

    public func takeover(leaseID: String) async throws -> PlaybackLeaseManifest {
        struct Input: Encodable { let confirm: Bool }
        return try await json(
            path: "/api/v1/playback-leases/\(leaseID)/takeover",
            method: "POST",
            body: Input(confirm: true)
        )
    }

    public func uploadCheckpoint(path: String, state: Data, capturedFrame: Int, leaseRevision: Int) async throws {
        var request = try authorizedRequest(path: path)
        request.httpMethod = "POST"
        request.httpBody = state
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(String(capturedFrame), forHTTPHeaderField: "X-Captured-Frame")
        request.setValue(String(leaseRevision), forHTTPHeaderField: "X-Lease-Revision")
        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
    }

    public func release(leaseID: String, revision: Int) async throws {
        var request = try authorizedRequest(path: "/api/v1/playback-leases/\(leaseID)")
        request.httpMethod = "DELETE"
        request.setValue(String(revision), forHTTPHeaderField: "X-Lease-Revision")
        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
    }

    public func recordRestoreAttempt(
        checkpointID: String,
        outcome: String,
        observedFrame: Int? = nil,
        reason: String? = nil
    ) async throws {
        struct Input: Encodable { let outcome: String; let observedFrame: Int?; let reason: String? }
        struct Envelope: Decodable { let recorded: Bool }
        let _: Envelope = try await json(
            path: try profiled("/api/v1/checkpoints/\(checkpointID)/restore-attempts"),
            method: "POST",
            body: Input(outcome: outcome, observedFrame: observedFrame, reason: reason)
        )
    }

    private func profiled(_ path: String) throws -> String {
        guard let profileKey else { throw PortalSessionError.invalidResponse }
        return "\(path)?profileKey=\(profileKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? profileKey)"
    }

    private func json<Response: Decodable>(path: String, authenticated: Bool = true) async throws -> Response {
        let request: URLRequest
        if authenticated {
            request = try authorizedRequest(path: path)
        } else {
            request = URLRequest(url: try url(path: path))
        }
        return try await execute(request)
    }

    private func json<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body,
        authenticated: Bool = true
    ) async throws -> Response {
        var request: URLRequest
        if authenticated {
            request = try authorizedRequest(path: path)
        } else {
            request = URLRequest(url: try url(path: path))
        }
        request.httpMethod = method
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await execute(request)
    }

    private func execute<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await urlSession.data(for: request)
        try validate(response: response, data: data)
        do { return try decoder.decode(Response.self, from: data) }
        catch { throw PortalSessionError.invalidResponse }
    }

    private func authorizedRequest(path: String) throws -> URLRequest {
        guard let credential else { throw PortalSessionError.missingCredential }
        var request = URLRequest(url: try url(path: path))
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func url(path: String) throws -> URL {
        guard let url = URL(string: path, relativeTo: endpoint)?.absoluteURL else {
            throw PortalSessionError.invalidEndpoint
        }
        return url
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw PortalSessionError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? decoder.decode(PortalAPIErrorEnvelope.self, from: data) {
                if envelope.error.code == "playback_conflict", let leaseID = envelope.error.details.leaseId {
                    throw PortalSessionError.playbackConflict(
                        leaseID: leaseID,
                        activeDeviceName: envelope.error.details.activeDeviceName ?? "another device"
                    )
                }
                throw PortalSessionError.api(
                    code: envelope.error.code,
                    message: envelope.error.message,
                    retryable: envelope.error.retryable
                )
            }
            throw PortalSessionError.invalidResponse
        }
    }
}
