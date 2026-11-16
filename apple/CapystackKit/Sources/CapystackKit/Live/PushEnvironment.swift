import Foundation

/// Which APNs host this build's tokens belong to (`env` in `POST /push/tokens`).
public enum PushEnvironment: String, Sendable, Codable {
    case sandbox, production

    /// From the embedded provisioning profile's `aps-environment` ("development" → sandbox). A device build without a
    /// profile (TestFlight, App Store) is production; the simulator is sandbox. On the Mac: the profile inside the app
    /// bundle, else sandbox for DEBUG builds and production for release builds.
    public static var current: PushEnvironment { detected }

    private static let detected: PushEnvironment = {
        #if os(iOS)
        #if targetEnvironment(simulator)
        return .sandbox
        #else
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision") else { return .production }
        return environment(fromProvisioning: try? Data(contentsOf: url)) ?? .production
        #endif
        #else
        let url = Bundle.main.bundleURL.appendingPathComponent("Contents/embedded.provisionprofile")
        if let found = environment(fromProvisioning: try? Data(contentsOf: url)) { return found }
        #if DEBUG
        return .sandbox
        #else
        return .production
        #endif
        #endif
    }()

    /// A provisioning profile is a CMS envelope around an XML property list: find the plist inside the bytes and read
    /// `Entitlements.aps-environment` (iOS) or `Entitlements.com.apple.developer.aps-environment` (macOS).
    static func environment(fromProvisioning data: Data?) -> PushEnvironment? {
        guard let data,
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), options: .backwards),
              start.lowerBound < end.upperBound,
              let plist = try? PropertyListSerialization.propertyList(
                from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any]
        else { return nil }
        let value = (entitlements["aps-environment"] ?? entitlements["com.apple.developer.aps-environment"]) as? String
        switch value {
        case "development": return .sandbox
        case "production": return .production
        default: return nil
        }
    }
}
