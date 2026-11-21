// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HomeGamePortalTV",
    platforms: [
        .macOS(.v15),
        .tvOS(.v18),
    ],
    products: [
        .library(name: "PortalCore", targets: ["PortalCore"]),
    ],
    targets: [
        .target(
            name: "PortalCore",
            path: "Modules"
        ),
        .testTarget(
            name: "PortalCoreTests",
            dependencies: ["PortalCore"],
            path: "Tests"
        ),
    ]
)
