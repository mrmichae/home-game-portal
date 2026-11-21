import FCEUmmCore
import Foundation
import PortalCore

struct NativeEmulatorFrame: Sendable {
    let rgba: Data
    let width: Int
    let height: Int
    let audio: Data
    let audioFrames: Int
    let sampleRate: Double
}

actor FCEUmmPlaybackAdapter: NESPlaybackAdapter {
    private var core: OpaquePointer?
    private var rom: Data?
    private var runTask: Task<Void, Never>?
    private var continuation: AsyncStream<NativeEmulatorFrame>.Continuation?
    private var inputs = [NESInput(), NESInput()]

    func frames() -> AsyncStream<NativeEmulatorFrame> {
        let pair = AsyncStream<NativeEmulatorFrame>.makeStream(bufferingPolicy: .bufferingNewest(2))
        continuation = pair.continuation
        return pair.stream
    }

    func prepare(rom: Data) async throws {
        try validateINES(rom)
        if core == nil {
            let root = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                .appending(path: "FCEUmm", directoryHint: .isDirectory)
            let system = root.appending(path: "System", directoryHint: .isDirectory)
            let saves = root.appending(path: "Saves", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: system, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: saves, withIntermediateDirectories: true)
            core = system.path.withCString { systemPath in
                saves.path.withCString { savePath in hgp_fceumm_create(systemPath, savePath) }
            }
        }
        guard let core else { throw NESPlaybackError.coreUnavailable }
        let loaded = rom.withUnsafeBytes { bytes in
            hgp_fceumm_load(core, bytes.baseAddress, bytes.count)
        }
        guard loaded else { throw NESPlaybackError.invalidCartridge }
        self.rom = rom
    }

    func start() async throws {
        guard core != nil, rom != nil else { throw NESPlaybackError.coreUnavailable }
        launchLoop()
    }

    func pause() async {
        runTask?.cancel()
        runTask = nil
    }

    func resume() async {
        launchLoop()
    }

    func restart() async throws {
        guard let core, let rom else { throw NESPlaybackError.coreUnavailable }
        runTask?.cancel()
        hgp_fceumm_unload(core)
        let loaded = rom.withUnsafeBytes { hgp_fceumm_load(core, $0.baseAddress, $0.count) }
        guard loaded else { throw NESPlaybackError.invalidCartridge }
        launchLoop()
    }

    func setInput(_ input: NESInput, player: Int) async {
        guard (1...2).contains(player) else { return }
        inputs[player - 1] = input
    }

    func captureState() async throws -> Data {
        guard let core else { throw NESPlaybackError.coreUnavailable }
        let count = hgp_fceumm_serialize_size(core)
        guard count > 0 else { throw NESPlaybackError.coreUnavailable }
        var state = Data(count: count)
        let captured = state.withUnsafeMutableBytes { hgp_fceumm_serialize(core, $0.baseAddress, count) }
        guard captured else { throw NESPlaybackError.coreUnavailable }
        return state
    }

    func restoreState(_ state: Data) async throws {
        guard let core else { throw NESPlaybackError.coreUnavailable }
        let restored = state.withUnsafeBytes { hgp_fceumm_unserialize(core, $0.baseAddress, $0.count) }
        guard restored else { throw NESPlaybackError.coreUnavailable }
    }

    func stop() async {
        runTask?.cancel()
        runTask = nil
        continuation?.finish()
        continuation = nil
        if let core {
            hgp_fceumm_destroy(core)
            self.core = nil
        }
        rom = nil
    }

    private func launchLoop() {
        guard runTask == nil else { return }
        runTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let started = ContinuousClock.now
                await self.runFrame()
                let elapsed = started.duration(to: .now)
                let frameDuration = Duration.seconds(1.0 / max(await self.framesPerSecond(), 1))
                if elapsed < frameDuration { try? await Task.sleep(for: frameDuration - elapsed) }
            }
        }
    }

    private func framesPerSecond() -> Double {
        core.map(hgp_fceumm_frames_per_second) ?? 60
    }

    private func runFrame() {
        guard let core else { return }
        hgp_fceumm_set_input(core, 0, buttonMask(inputs[0]))
        hgp_fceumm_set_input(core, 1, buttonMask(inputs[1]))
        guard hgp_fceumm_run_frame(core) else { return }
        var width: UInt32 = 0
        var height: UInt32 = 0
        var pitch = 0
        guard let pixels = hgp_fceumm_video(core, &width, &height, &pitch), width > 0, height > 0 else { return }
        let rgba = convertRGB565(pixels: pixels, width: Int(width), height: Int(height), pitch: pitch)
        var audio = Data(count: 4096 * 2 * MemoryLayout<Int16>.size)
        let frames = audio.withUnsafeMutableBytes { bytes in
            hgp_fceumm_read_audio(core, bytes.bindMemory(to: Int16.self).baseAddress, 4096)
        }
        audio.count = frames * 2 * MemoryLayout<Int16>.size
        continuation?.yield(NativeEmulatorFrame(
            rgba: rgba,
            width: Int(width),
            height: Int(height),
            audio: audio,
            audioFrames: frames,
            sampleRate: hgp_fceumm_audio_sample_rate(core)
        ))
    }
}

private func buttonMask(_ input: NESInput) -> UInt16 {
    var mask: UInt16 = 0
    if input.b { mask |= 1 << 0 }
    if input.select { mask |= 1 << 2 }
    if input.start { mask |= 1 << 3 }
    if input.up { mask |= 1 << 4 }
    if input.down { mask |= 1 << 5 }
    if input.left { mask |= 1 << 6 }
    if input.right { mask |= 1 << 7 }
    if input.a { mask |= 1 << 8 }
    return mask
}

private func convertRGB565(pixels: UnsafePointer<UInt16>, width: Int, height: Int, pitch: Int) -> Data {
    var output = Data(count: width * height * 4)
    output.withUnsafeMutableBytes { raw in
        let destination = raw.bindMemory(to: UInt8.self)
        let sourceStride = pitch / MemoryLayout<UInt16>.size
        for y in 0..<height {
            for x in 0..<width {
                let value = pixels[y * sourceStride + x]
                let offset = (y * width + x) * 4
                destination[offset] = UInt8((UInt32(value >> 11) * 255) / 31)
                destination[offset + 1] = UInt8((UInt32((value >> 5) & 63) * 255) / 63)
                destination[offset + 2] = UInt8((UInt32(value & 31) * 255) / 31)
                destination[offset + 3] = 255
            }
        }
    }
    return output
}
