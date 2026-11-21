import Foundation

public struct PendingCheckpoint: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let serverID: String
    public let leaseID: String
    public let leaseRevision: Int
    public let uploadPath: String
    public let capturedFrame: Int
    public let createdAt: Date
    public let fileName: String
}

public actor CheckpointOutbox {
    private let root: URL
    private let indexURL: URL
    private var pending: [PendingCheckpoint] = []

    public init(root: URL? = nil) throws {
        let support = try root ?? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appending(path: "HomeGamePortalTV/CheckpointOutbox", directoryHint: .isDirectory)
        self.root = support
        self.indexURL = support.appending(path: "index.json")
        try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableRoot = support
        try mutableRoot.setResourceValues(values)
        if let data = try? Data(contentsOf: indexURL) {
            self.pending = (try? JSONDecoder().decode([PendingCheckpoint].self, from: data)) ?? []
        }
    }

    public func all() -> [PendingCheckpoint] { pending.sorted { $0.createdAt < $1.createdAt } }

    @discardableResult
    public func enqueue(
        state: Data,
        serverID: String,
        leaseID: String,
        leaseRevision: Int,
        uploadPath: String,
        capturedFrame: Int
    ) throws -> PendingCheckpoint {
        let id = UUID()
        let item = PendingCheckpoint(
            id: id,
            serverID: serverID,
            leaseID: leaseID,
            leaseRevision: leaseRevision,
            uploadPath: uploadPath,
            capturedFrame: capturedFrame,
            createdAt: Date(),
            fileName: "\(id.uuidString).state"
        )
        try state.write(to: root.appending(path: item.fileName), options: [.atomic, .completeFileProtection])
        pending.append(item)
        try persist()
        return item
    }

    public func data(for item: PendingCheckpoint) throws -> Data {
        try Data(contentsOf: root.appending(path: item.fileName))
    }

    public func acknowledge(_ id: UUID) throws {
        guard let item = pending.first(where: { $0.id == id }) else { return }
        try? FileManager.default.removeItem(at: root.appending(path: item.fileName))
        pending.removeAll { $0.id == id }
        try persist()
    }

    private func persist() throws {
        try JSONEncoder().encode(pending).write(to: indexURL, options: [.atomic, .completeFileProtection])
    }
}
