import CapystackKit
@preconcurrency import PostHog
import SwiftUI

/// PostHog in the app (docs/CONTRACT.md section 9). The only file besides PrivacyMask.swift that imports PostHog.
/// - The project (token, host) comes from `GET /capabilities`: no token in the binary, and a server without one never
///   starts the SDK. Previews never start it.
/// - The person is this device's session id, the same distinct id the API's events use.
/// - Session replay on iPhone and iPad, screenshot mode, every image and text input masked by the SDK, and every view
///   that draws user content wears `.privacyMask()`.
@MainActor
enum Analytics {
    private static var configured = false
    private static var running = false
    private static var identified: String?

    /// Starts, stops or leaves the SDK as the capabilities say. Cheap; call it whenever they or the account change.
    static func sync(_ model: AppModel) {
        guard !model.isPreview, model.auth == .signedIn, let project = model.capabilities.postHogProject else {
            stop()
            return
        }
        if !configured {
            let config = PostHogConfig(apiKey: project.token, host: project.host.absoluteString)
            config.captureApplicationLifecycleEvents = true
            // SwiftUI screens are named by hand (`screen`)
            config.captureScreenViews = false
            #if os(iOS)
            config.sessionReplay = true
            config.sessionReplayConfig.screenshotMode = true
            config.sessionReplayConfig.maskAllImages = true
            config.sessionReplayConfig.maskAllTextInputs = true
            #endif
            PostHogSDK.shared.setup(config)
            configured = true
        } else if !running {
            PostHogSDK.shared.optIn()
        }
        running = true
        if let id = model.account.me?.id, id != identified {
            PostHogSDK.shared.identify(id)
            identified = id
        }
    }

    static func stop() {
        guard running else { return }
        PostHogSDK.shared.optOut()
        running = false
    }

    /// Sign-out: a new anonymous person next time.
    static func reset() {
        if configured { PostHogSDK.shared.reset() }
        identified = nil
        stop()
    }

    /// A screen the owner opened (`$screen`).
    static func screen(_ name: String) {
        guard running else { return }
        PostHogSDK.shared.screen(name)
    }

    /// A named event with flat properties. Never note text or titles: counts, results and times only.
    static func event(_ name: String, _ properties: [String: Any] = [:]) {
        guard running else { return }
        PostHogSDK.shared.capture(name, properties: properties)
    }
}
