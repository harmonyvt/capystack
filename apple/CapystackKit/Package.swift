// swift-tools-version: 6.0
import PackageDescription

// Models, the API client, sign-in, the offline notes store (SQLite3 from the SDK), Live Activity types and preview data.
// No third-party dependencies: PostHog lives in the app target only.
let package = Package(
    name: "CapystackKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "CapystackKit", targets: ["CapystackKit"]),
    ],
    targets: [
        .target(name: "CapystackKit", linkerSettings: [.linkedLibrary("sqlite3")]),
        .testTarget(name: "CapystackKitTests", dependencies: ["CapystackKit"]),
    ]
)
