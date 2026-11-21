import Foundation
import Combine

public struct DiscoveredPortal: Hashable, Identifiable, Sendable {
    public var id: String { serverID ?? "\(name)|\(endpoint.absoluteString)" }
    public let name: String
    public let endpoint: URL
    public let serverID: String?
    public let apiVersion: String?
}

/** Resolves DNS-SD services to HTTP endpoints; callers never handle NetService. */
@MainActor
public final class PortalDiscovery: NSObject, ObservableObject, NetServiceBrowserDelegate, NetServiceDelegate {
    @Published public private(set) var portals: [DiscoveredPortal] = []
    @Published public private(set) var isSearching = false
    @Published public private(set) var errorMessage: String?
    private let browser = NetServiceBrowser()
    private var resolving: [String: NetService] = [:]

    public override init() {
        super.init()
        browser.delegate = self
    }

    public func start() {
        guard !isSearching else { return }
        portals = []
        errorMessage = nil
        isSearching = true
        browser.searchForServices(ofType: "_homegameportal._tcp.", inDomain: "local.")
    }

    public func stop() {
        browser.stop()
        for service in resolving.values { service.stop() }
        resolving.removeAll()
        isSearching = false
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        resolving[serviceKey(service)] = service
        service.resolve(withTimeout: 5)
    }

    public func netServiceDidResolveAddress(_ sender: NetService) {
        defer { resolving.removeValue(forKey: serviceKey(sender)) }
        guard let host = sender.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: ".")),
              sender.port > 0,
              let endpoint = URL(string: "http://\(host):\(sender.port)")
        else { return }
        let txt = Self.decodeTXT(sender.txtRecordData())
        let portal = DiscoveredPortal(
            name: txt["name"] ?? sender.name,
            endpoint: endpoint,
            serverID: txt["id"],
            apiVersion: txt["api"]
        )
        portals.removeAll { $0.id == portal.id }
        portals.append(portal)
        portals.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    public func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        resolving.removeValue(forKey: serviceKey(sender))
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        isSearching = false
        errorMessage = "Bonjour discovery could not start. You can still enter the server address manually."
    }

    private func serviceKey(_ service: NetService) -> String {
        "\(service.name)|\(service.type)|\(service.domain)"
    }

    private nonisolated static func decodeTXT(_ data: Data?) -> [String: String] {
        guard let data else { return [:] }
        return NetService.dictionary(fromTXTRecord: data).reduce(into: [:]) { result, entry in
            if let value = String(data: entry.value, encoding: .utf8) { result[entry.key] = value }
        }
    }
}
