import CapystackKit
import SwiftUI

/// The app's three areas.
enum AppTab: String, CaseIterable, Identifiable, Hashable {
    case notes, chat, settings

    var id: Self { self }

    var title: String {
        switch self {
        case .notes: return Copy.Tabs.notes
        case .chat: return Copy.Tabs.chat
        case .settings: return Copy.Tabs.settings
        }
    }

    var symbol: String {
        switch self {
        case .notes: return Symbol.notes
        case .chat: return Symbol.chat
        case .settings: return Symbol.settings
        }
    }
}

/// The root: the sign-in screen until this device holds a token, then the adaptive shell.
struct AppShell: View {
    let model: AppModel

    var body: some View {
        content
            .toastHost(model)
            .environment(\.hapticsEnabled, model.hapticsEnabled)
            .tint(Tokens.Color.accent)
            .motion(Tokens.Motion.spring, value: model.auth)
    }

    @ViewBuilder private var content: some View {
        if model.auth == .signedIn {
            AdaptiveShell(model: model)
        } else {
            SignInScreen(model: model)
        }
    }
}

/// Tab bar on iPhone (compact width), sidebar on iPad and the Mac. The selected area survives the switch.
struct AdaptiveShell: View {
    let model: AppModel
    @State private var tab: AppTab = .notes
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        layout
            .onOpenURL { url in route(url) }
    }

    @ViewBuilder private var layout: some View {
        #if os(iOS)
        if sizeClass == .compact {
            PhoneTabs(model: model, selection: $tab)
        } else {
            SidebarShell(model: model, selection: $tab)
        }
        #else
        SidebarShell(model: model, selection: $tab)
        #endif
    }

    /// `capystack://jobs/<id>` (a tap on the Live Activity) opens settings, where the demo job shows.
    /// The sign-in callback never gets here: the web sheet keeps it.
    private func route(_ url: URL) {
        guard url.scheme?.lowercased() == AppConfig.urlScheme, !AccountAuth.isCallback(url) else { return }
        switch url.host(percentEncoded: false)?.lowercased() {
        case "jobs": tab = .settings
        case "notes": tab = .notes
        case "chat": tab = .chat
        default: break
        }
    }
}

/// One area's screen; each brings its own navigation stack.
struct TabScreen: View {
    let model: AppModel
    let tab: AppTab

    var body: some View {
        switch tab {
        case .notes: NotesScreen(model: model)
        case .chat: ChatScreen(model: model)
        case .settings: SettingsScreen(model: model)
        }
    }
}
