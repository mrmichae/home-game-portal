import Foundation

public struct PortalServerDescriptor: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public var serverID: String?
    public var name: String
    public var endpoint: URL
    public var credentialAccount: String?

    public init(id: UUID = UUID(), serverID: String? = nil, name: String, endpoint: URL, credentialAccount: String? = nil) {
        self.id = id
        self.serverID = serverID
        self.name = name
        self.endpoint = endpoint
        self.credentialAccount = credentialAccount
    }
}

public struct SystemCapabilities: Decodable, Sendable {
    public struct Transport: Decodable, Sendable {
        public let scope: String
        public let https: Bool
    }

    public struct Capabilities: Decodable, Sendable {
        public struct NativePlayback: Decodable, Sendable {
            public let platformKey: String
            public let coreKey: String
        }

        public struct CheckpointFormat: Decodable, Sendable {
            public let key: String
            public let coreKey: String
            public let status: String
        }

        public let platforms: [String]
        public let nativePlayback: [NativePlayback]
        public let checkpointFormats: [CheckpointFormat]
    }

    public let serverId: String
    public let serverName: String
    public let serverVersion: String
    public let apiVersions: [String]
    public let minimumClientVersion: String
    public let pairingRequired: Bool
    public let transport: Transport
    public let capabilities: Capabilities
}

public struct PlayerProfile: Codable, Hashable, Identifiable, Sendable {
    public var id: String { key }
    public let key: String
    public let displayName: String
    public let isAdministrator: Bool
    public let avatarKey: String
    public let avatarColor: String
    public let themeKey: String
    public let accentColor: String
    public let controllerPreset: String
}

public struct GameSummary: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let displayName: String
    public let platform: String
    public let platformName: String
    public let addedAt: String
    public let byteSize: Int
    public let releaseYear: Int
    public let description: String
    public let genres: [String]
    public let series: String?
    public let universes: [String]
    public let coverUrl: String
    public let hasServerSave: Bool
    public let isContinuePlaying: Bool
    public let saveUpdatedAt: String?
    public let isFavorite: Bool
    public let lastPlayedAt: String?
    public let metadataStatus: String

    public func withFavorite(_ value: Bool) -> GameSummary {
        GameSummary(
            id: id,
            displayName: displayName,
            platform: platform,
            platformName: platformName,
            addedAt: addedAt,
            byteSize: byteSize,
            releaseYear: releaseYear,
            description: description,
            genres: genres,
            series: series,
            universes: universes,
            coverUrl: coverUrl,
            hasServerSave: hasServerSave,
            isContinuePlaying: isContinuePlaying,
            saveUpdatedAt: saveUpdatedAt,
            isFavorite: value,
            lastPlayedAt: lastPlayedAt,
            metadataStatus: metadataStatus
        )
    }
}

public struct PairingEnvelope: Decodable, Sendable {
    public struct Pairing: Decodable, Sendable {
        public let id: String
        public let code: String
        public let pollSecret: String
        public let expiresAt: String
    }
    public let pairing: Pairing
}

public struct PairingStatusEnvelope: Decodable, Sendable {
    public struct PairingStatus: Decodable, Sendable {
        public let state: String
        public let deviceId: String?
        public let expiresAt: String
    }
    public let pairing: PairingStatus
}

public struct ProfilesEnvelope: Decodable, Sendable {
    public let profiles: [PlayerProfile]
}

public struct CatalogEnvelope: Decodable, Sendable {
    public struct Shelf: Decodable, Sendable {
        public let id: String
        public let title: String
        public let games: [GameSummary]
    }
    public let shelf: Shelf
    public let presentation: CatalogPresentation
}

public struct CatalogPresentation: Decodable, Sendable {
    public struct Collection: Decodable, Hashable, Identifiable, Sendable {
        public let id: String
        public let slug: String
        public let name: String
        public let description: String
        public let games: [GameSummary]
    }

    public struct BrowseRow: Decodable, Hashable, Identifiable, Sendable {
        public let id: String
        public let title: String
        public let position: Int
        public let games: [GameSummary]
    }

    public let collections: [Collection]
    public let browseRows: [BrowseRow]

    public static let empty = CatalogPresentation(collections: [], browseRows: [])

    public init(collections: [Collection], browseRows: [BrowseRow]) {
        self.collections = collections
        self.browseRows = browseRows
    }
}

public struct PlaybackLeaseManifest: Decodable, Sendable {
    public struct Lease: Decodable, Sendable {
        public let id: String
        public let revision: Int
        public let expiresAt: String
        public let renewalIntervalSeconds: Int
    }

    public struct GameFile: Decodable, Sendable {
        public let grantId: String
        public let downloadUrl: String
        public let expiresAt: String
        public let byteSize: Int
        public let sha256: String
    }

    public struct Checkpoint: Decodable, Sendable {
        public let id: String
        public let lineageId: String
        public let formatKey: String
        public let generation: Int
        public let status: String
        public let byteSize: Int
        public let stateSha256: String
        public let capturedFrame: Int
        public let createdAt: String
        public let downloadUrl: String
    }

    public struct CheckpointUpload: Decodable, Sendable {
        public let url: String
        public let maximumBytes: Int
        public let requiredLeaseRevision: Int
    }

    public let lease: Lease
    public let gameFile: GameFile
    public let intent: String
    public let checkpoints: [Checkpoint]
    public let checkpointUpload: CheckpointUpload
}

public struct PortalAPIErrorEnvelope: Decodable, Sendable {
    public struct Body: Decodable, Sendable {
        public struct Details: Decodable, Sendable {
            public let activeDeviceName: String?
            public let leaseId: String?
        }

        public let code: String
        public let message: String
        public let retryable: Bool
        public let details: Details
    }
    public let error: Body
}

public enum PortalSessionError: LocalizedError, Sendable {
    case invalidEndpoint
    case nonLocalEndpoint
    case incompatibleServer
    case missingCredential
    case invalidResponse
    case playbackConflict(leaseID: String, activeDeviceName: String)
    case api(code: String, message: String, retryable: Bool)

    public var errorDescription: String? {
        switch self {
        case .invalidEndpoint: "Enter a valid server hostname or IP address and port."
        case .nonLocalEndpoint: "The Apple TV app only connects to servers on your local network."
        case .incompatibleServer: "This Portal Server does not support the app's API."
        case .missingCredential: "This Apple TV must be paired again."
        case .invalidResponse: "The Portal Server returned an invalid response."
        case let .playbackConflict(_, activeDeviceName): "This game is active on \(activeDeviceName)."
        case let .api(_, message, _): message
        }
    }
}
