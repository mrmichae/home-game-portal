import Foundation

public struct NESInput: Sendable, Equatable {
    public var up = false
    public var down = false
    public var left = false
    public var right = false
    public var a = false
    public var b = false
    public var start = false
    public var select = false

    public init() {}
}

public protocol NESPlaybackAdapter: AnyObject, Sendable {
    func prepare(rom: Data) async throws
    func start() async throws
    func pause() async
    func resume() async
    func restart() async throws
    func setInput(_ input: NESInput, player: Int) async
    func captureState() async throws -> Data
    func restoreState(_ state: Data) async throws
    func stop() async
}

public enum NESPlaybackError: LocalizedError, Sendable {
    case coreUnavailable
    case invalidCartridge

    public var errorDescription: String? {
        switch self {
        case .coreUnavailable: "The pinned FCEUmm core is not linked into this build."
        case .invalidCartridge: "The downloaded file is not a valid NES cartridge."
        }
    }
}

public func validateINES(_ data: Data) throws {
    guard data.count >= 16, Array(data.prefix(4)) == [0x4e, 0x45, 0x53, 0x1a] else {
        throw NESPlaybackError.invalidCartridge
    }
}
