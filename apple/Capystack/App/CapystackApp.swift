import CapystackKit
import SwiftUI

@main
struct CapystackApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    #else
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    #endif
    @State private var model: AppModel

    init() {
        let model = LaunchConfig.makeModel()
        _model = State(initialValue: model)
        PushBridge.model = model
    }

    var body: some Scene {
        WindowGroup {
            AppShell(model: model)
                .modifier(AppLifecycle(model: model))
        }
        #if os(macOS)
        .defaultSize(width: 1000, height: 700)
        #endif
    }
}

/// What the first scene does for the whole app: launch once, pull on foreground, keep PostHog and push in step with
/// the server's capabilities and the sign-in state.
private struct AppLifecycle: ViewModifier {
    let model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .task {
                await model.launch()
                Analytics.sync(model)
                PushBridge.registerIfWanted(model)
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await model.foreground() }
            }
            .onChange(of: model.capabilities) { _, _ in
                Analytics.sync(model)
                PushBridge.registerIfWanted(model)
            }
            .onChange(of: model.auth) { _, auth in
                if auth == .signedOut { Analytics.reset() }
                PushBridge.registerIfWanted(model)
            }
            .onChange(of: model.account.me?.id) { _, _ in Analytics.sync(model) }
    }
}

/// `-previewScenario signedIn|signedOut|empty|offline|expired` (DEBUG builds only) runs the app over
/// `AppModel.preview(<scenario>)`: no network, no keychain. Without it the app is live.
@MainActor
private enum LaunchConfig {
    static func makeModel() -> AppModel {
        #if DEBUG
        if let raw = UserDefaults.standard.string(forKey: "previewScenario"), let scenario = PreviewScenario(rawValue: raw) {
            return AppModel.preview(scenario)
        }
        #endif
        return AppModel.live()
    }
}
