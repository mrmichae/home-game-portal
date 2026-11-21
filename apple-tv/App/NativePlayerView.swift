import AVFoundation
import CoreImage
import MetalKit
import PortalCore
import SwiftUI

@MainActor
final class NativePlayerModel: ObservableObject {
    @Published var frame: NativeEmulatorFrame?
    @Published var errorMessage: String?
    @Published var frameNumber = 0

    let adapter = FCEUmmPlaybackAdapter()
    private let audioEngine = AVAudioEngine()
    private let audioPlayer = AVAudioPlayerNode()
    private var frameTask: Task<Void, Never>?
    private var audioFormat: AVAudioFormat?

    func start(rom: Data, resumeState: Data?) async -> Bool {
        guard frameTask == nil else { return true }
        do {
            let frames = await adapter.frames()
            try await adapter.prepare(rom: rom)
            if let resumeState { try await adapter.restoreState(resumeState) }
            try configureAudio()
            try await adapter.start()
            frameTask = Task { [weak self] in
                for await frame in frames {
                    guard let self else { return }
                    self.frame = frame
                    self.frameNumber += 1
                    self.scheduleAudio(frame)
                }
            }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func setInputs(_ inputs: [Int: NESInput]) {
        Task {
            await adapter.setInput(inputs[1] ?? NESInput(), player: 1)
            await adapter.setInput(inputs[2] ?? NESInput(), player: 2)
        }
    }

    func captureState() async -> Data? {
        try? await adapter.captureState()
    }

    func pause() { Task { await adapter.pause() } }
    func resume() { Task { await adapter.resume() } }

    func restart() async {
        do {
            try await adapter.restart()
            frameNumber = 0
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func stop() async {
        frameTask?.cancel()
        frameTask = nil
        audioPlayer.stop()
        audioEngine.stop()
        await adapter.stop()
    }

    private func configureAudio() throws {
        audioEngine.attach(audioPlayer)
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
        audioEngine.connect(audioPlayer, to: audioEngine.mainMixerNode, format: format)
        audioEngine.prepare()
        try audioEngine.start()
        audioPlayer.play()
        audioFormat = format
    }

    private func scheduleAudio(_ frame: NativeEmulatorFrame) {
        guard frame.audioFrames > 0, let format = audioFormat,
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(frame.audioFrames)
              ), let channels = buffer.floatChannelData
        else { return }
        buffer.frameLength = AVAudioFrameCount(frame.audioFrames)
        frame.audio.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for index in 0..<frame.audioFrames {
                channels[0][index] = Float(samples[index * 2]) / Float(Int16.max)
                channels[1][index] = Float(samples[index * 2 + 1]) / Float(Int16.max)
            }
        }
        audioPlayer.scheduleBuffer(buffer)
    }
}

struct NativePlayerView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var player = NativePlayerModel()
    @State private var overlayVisible = true
    @State private var confirmRestart = false
    @State private var confirmExit = false
    @State private var controllerCount = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            NESMetalView(frame: player.frame)
                .ignoresSafeArea()
            if overlayVisible || player.errorMessage != nil {
                VStack {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(app.activeGame?.displayName ?? "NES Game").font(.title.bold())
                            Text(player.errorMessage ?? "FCEUmm · \(player.frameNumber) frames")
                                .foregroundStyle(player.errorMessage == nil ? .secondary : .red)
                        }
                        Spacer()
                        HStack(spacing: 18) {
                            Button("Resume") { overlayVisible = false; player.resume() }
                            Button("Save Now") {
                                Task {
                                    if let state = await player.captureState() {
                                        await app.publishCheckpoint(state, frame: player.frameNumber)
                                    }
                                }
                            }
                            Button("Restart") { confirmRestart = true }
                            Button("Exit Game") { confirmExit = true }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(42)
                    .background(.black.opacity(0.78))
                    HStack(spacing: 24) {
                        Label("4:3 · nearest-neighbor", systemImage: "rectangle.inset.filled")
                        ForEach(app.controllers.assignments) { assignment in
                            Label("P\(assignment.player) \(assignment.name)", systemImage: "gamecontroller.fill")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 42)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.black.opacity(0.78))
                    Spacer()
                }
            }
        }
        .onTapGesture { overlayVisible.toggle() }
        .onReceive(app.controllers.$playerInputs) { player.setInputs($0) }
        .task {
            guard let rom = app.downloadedROM else { return }
            let started = await player.start(rom: rom, resumeState: app.resumeState)
            if started { overlayVisible = false }
            if started, app.resumeState != nil {
                let initialFrame = player.frameNumber
                for _ in 0..<120 where player.frameNumber < initialFrame + 5 {
                    try? await Task.sleep(for: .milliseconds(16))
                }
                if player.frameNumber >= initialFrame + 5 {
                    await app.recordRestoreSucceeded(frame: player.frameNumber)
                } else {
                    await app.recordRestoreFailed(reason: "The restored core did not advance frames.")
                    player.errorMessage = "This checkpoint did not resume safely. Exit and try an older generation."
                    overlayVisible = true
                }
            }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled, let state = await player.captureState() else { continue }
                await app.publishCheckpoint(state, frame: player.frameNumber)
            }
        }
        .onReceive(app.controllers.$assignments) { assignments in
            if assignments.count < controllerCount {
                player.pause()
                overlayVisible = true
            }
            controllerCount = assignments.count
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                player.resume()
            } else {
                player.pause()
                Task {
                    if let state = await player.captureState() {
                        await app.publishCheckpoint(state, frame: player.frameNumber)
                    }
                }
            }
        }
        .onExitCommand {
            player.pause()
            overlayVisible = true
            Task {
                if let state = await player.captureState() {
                    await app.publishCheckpoint(state, frame: player.frameNumber)
                }
            }
        }
        .onDisappear { Task { await player.stop() } }
        .confirmationDialog("Restart from the beginning? Your last acknowledged checkpoint remains available.", isPresented: $confirmRestart, titleVisibility: .visible) {
            Button("Restart", role: .destructive) { Task { await player.restart(); overlayVisible = false } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Save progress and exit this game?", isPresented: $confirmExit, titleVisibility: .visible) {
            Button("Save & Exit") {
                Task {
                    if let state = await player.captureState() {
                        await app.publishCheckpoint(state, frame: player.frameNumber)
                    }
                    await player.stop()
                    await app.leavePlayer()
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }
}

private struct NESMetalView: UIViewRepresentable {
    let frame: NativeEmulatorFrame?

    func makeCoordinator() -> Renderer { Renderer() }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView()
        view.device = MTLCreateSystemDefaultDevice()
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColorMake(0, 0, 0, 1)
        view.framebufferOnly = false
        view.isPaused = true
        view.enableSetNeedsDisplay = true
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ view: MTKView, context: Context) {
        context.coordinator.frame = frame
        view.setNeedsDisplay()
    }

    final class Renderer: NSObject, MTKViewDelegate {
        var frame: NativeEmulatorFrame?
        private var context: CIContext?
        private var queue: MTLCommandQueue?

        func attach(to view: MTKView) {
            guard let device = view.device else { return }
            context = CIContext(mtlDevice: device)
            queue = device.makeCommandQueue()
            view.delegate = self
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

        func draw(in view: MTKView) {
            guard let frame, let drawable = view.currentDrawable,
                  let descriptor = view.currentRenderPassDescriptor,
                  let commandBuffer = queue?.makeCommandBuffer(),
                  let clear = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor),
                  let context
            else { return }
            clear.endEncoding()
            let colorSpace = CGColorSpaceCreateDeviceRGB()
            let source = CIImage(
                bitmapData: frame.rgba,
                bytesPerRow: frame.width * 4,
                size: CGSize(width: frame.width, height: frame.height),
                format: .RGBA8,
                colorSpace: colorSpace
            )
            let scale = min(view.drawableSize.width / CGFloat(frame.width), view.drawableSize.height / CGFloat(frame.height))
            let width = CGFloat(frame.width) * scale
            let height = CGFloat(frame.height) * scale
            let x = (view.drawableSize.width - width) / 2
            let y = (view.drawableSize.height - height) / 2
            let image = source.samplingNearest().transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                .transformed(by: CGAffineTransform(translationX: x, y: y))
            context.render(
                image,
                to: drawable.texture,
                commandBuffer: commandBuffer,
                bounds: CGRect(origin: .zero, size: view.drawableSize),
                colorSpace: colorSpace
            )
            commandBuffer.present(drawable)
            commandBuffer.commit()
        }
    }
}
