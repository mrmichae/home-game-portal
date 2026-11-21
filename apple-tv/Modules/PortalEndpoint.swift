import Foundation

public enum PortalEndpoint {
    public static func normalize(_ input: String, defaultPort: Int = 8090) throws -> URL {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw PortalSessionError.invalidEndpoint }
        let candidate = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard var components = URLComponents(string: candidate),
              let host = components.host,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.scheme == "http" || components.scheme == "https"
        else { throw PortalSessionError.invalidEndpoint }
        guard isLocalHost(host) else { throw PortalSessionError.nonLocalEndpoint }
        components.port = components.port ?? defaultPort
        components.path = ""
        guard let url = components.url else { throw PortalSessionError.invalidEndpoint }
        return url
    }

    public static func isLocalHost(_ host: String) -> Bool {
        let value = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if value == "localhost" || value.hasSuffix(".local") || !value.contains(".") { return true }
        if value == "::1" || value.hasPrefix("fe80:") || value.hasPrefix("fd") || value.hasPrefix("fc") { return true }
        let octets = value.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else { return false }
        return octets[0] == 10
            || octets[0] == 127
            || (octets[0] == 192 && octets[1] == 168)
            || (octets[0] == 172 && (16...31).contains(octets[1]))
            || (octets[0] == 169 && octets[1] == 254)
    }
}
