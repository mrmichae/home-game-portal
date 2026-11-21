import Foundation
import Testing
@testable import PortalCore

@Test func endpointNormalizationAcceptsOnlyLANAddresses() throws {
    #expect(try PortalEndpoint.normalize("192.168.1.25:8090").absoluteString == "http://192.168.1.25:8090")
    #expect(try PortalEndpoint.normalize("arcade.local").port == 8090)
    #expect(throws: PortalSessionError.self) { try PortalEndpoint.normalize("https://example.com") }
}

@Test func serverStoreSupportsMultipleServersAndSelection() async throws {
    let suite = "PortalCoreTests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = ServerStore(defaults: defaults)
    let first = PortalServerDescriptor(name: "Upstairs", endpoint: try #require(URL(string: "http://upstairs.local:8090")))
    let second = PortalServerDescriptor(name: "Basement", endpoint: try #require(URL(string: "http://basement.local:8090")))
    try await store.save(first)
    try await store.save(second)
    #expect(await store.load().count == 2)
    #expect(await store.active()?.id == second.id)
    await store.select(first.id)
    #expect(await store.active()?.id == first.id)
}

@Test func cartridgeValidationChecksINESHeader() throws {
    try validateINES(Data([0x4e, 0x45, 0x53, 0x1a] + Array(repeating: 0, count: 12)))
    #expect(throws: NESPlaybackError.self) { try validateINES(Data([0, 1, 2, 3])) }
}
