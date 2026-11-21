import Foundation
import GameController
import Combine

public struct ControllerAssignment: Identifiable, Sendable {
    public let id: ObjectIdentifier
    public let player: Int
    public let name: String
}

@MainActor
public final class ControllerCoordinator: ObservableObject {
    @Published public private(set) var assignments: [ControllerAssignment] = []
    @Published public private(set) var playerInputs = [1: NESInput(), 2: NESInput()]
    private var observers: [NSObjectProtocol] = []

    public init() {
        observers.append(NotificationCenter.default.addObserver(
            forName: .GCControllerDidConnect, object: nil, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.refresh() } })
        observers.append(NotificationCenter.default.addObserver(
            forName: .GCControllerDidDisconnect, object: nil, queue: .main
        ) { [weak self] _ in Task { @MainActor in self?.refresh() } })
        GCController.startWirelessControllerDiscovery {}
        refresh()
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    public var hasRequiredController: Bool { !assignments.isEmpty }

    public func refresh() {
        let controllers = Array(GCController.controllers().prefix(2))
        assignments = controllers.enumerated().map { index, controller in
            ControllerAssignment(
                id: ObjectIdentifier(controller),
                player: index + 1,
                name: controller.vendorName ?? "Game Controller"
            )
        }
        for (index, controller) in controllers.enumerated() { configure(controller, player: index + 1) }
        if controllers.count < 2 { playerInputs[2] = NESInput() }
        if controllers.isEmpty { playerInputs[1] = NESInput() }
    }

    private func configure(_ controller: GCController, player: Int) {
        guard let gamepad = controller.extendedGamepad else { return }
        gamepad.valueChangedHandler = { [weak self] pad, _ in
            var input = NESInput()
            input.up = pad.dpad.up.isPressed
            input.down = pad.dpad.down.isPressed
            input.left = pad.dpad.left.isPressed
            input.right = pad.dpad.right.isPressed
            input.a = pad.buttonA.isPressed
            input.b = pad.buttonX.isPressed
            input.start = pad.buttonMenu.isPressed
            input.select = pad.buttonOptions?.isPressed ?? false
            Task { @MainActor in self?.playerInputs[player] = input }
        }
    }
}
