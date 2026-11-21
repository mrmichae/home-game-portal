import Foundation

public actor ServerStore {
    private let defaults: UserDefaults
    private let key = "portal.servers.v1"
    private let activeKey = "portal.active-server.v1"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> [PortalServerDescriptor] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([PortalServerDescriptor].self, from: data)) ?? []
    }

    public func save(_ descriptor: PortalServerDescriptor) throws {
        var servers = load()
        if let index = servers.firstIndex(where: { $0.serverID == descriptor.serverID && descriptor.serverID != nil }) {
            servers[index] = descriptor
        } else if let index = servers.firstIndex(where: { $0.id == descriptor.id }) {
            servers[index] = descriptor
        } else {
            servers.append(descriptor)
        }
        defaults.set(try JSONEncoder().encode(servers), forKey: key)
        defaults.set(descriptor.id.uuidString, forKey: activeKey)
    }

    public func active() -> PortalServerDescriptor? {
        guard let value = defaults.string(forKey: activeKey), let id = UUID(uuidString: value) else { return nil }
        return load().first { $0.id == id }
    }

    public func select(_ id: UUID) {
        defaults.set(id.uuidString, forKey: activeKey)
    }

    public func forget(_ id: UUID) throws {
        let servers = load().filter { $0.id != id }
        defaults.set(try JSONEncoder().encode(servers), forKey: key)
        if defaults.string(forKey: activeKey) == id.uuidString { defaults.removeObject(forKey: activeKey) }
    }
}
