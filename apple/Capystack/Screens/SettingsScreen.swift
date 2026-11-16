import CapystackKit
import SwiftUI

/// Settings: this device and the others signed in, keys for tools, the Live Activity demo, preferences, the design
/// gallery, and sign out.
struct SettingsScreen: View {
    let model: AppModel

    var body: some View {
        NavigationStack {
            Form {
                DevicesSection(model: model)
                KeysSection(model: model)
                DemoJobSection(model: model)
                PreferencesSection(model: model)
                AboutSection(model: model)
                SignOutSection(model: model)
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Tokens.Color.bg)
            .navigationTitle(Copy.Settings.title)
            .task { await model.account.refresh() }
            .refreshable { await model.account.refresh() }
        }
        .onAppear { Analytics.screen("settings") }
    }
}

// MARK: - devices

private struct DevicesSection: View {
    let model: AppModel

    var body: some View {
        Section(Copy.Settings.devices) {
            let account = model.account
            if account.phase == .loading && account.sessions.isEmpty {
                Skeleton(width: 200, height: 16)
                Skeleton(width: 160, height: 16)
            } else {
                ForEach(account.sessions) { session in
                    SessionRow(model: model, session: session)
                }
            }
        }
    }
}

private struct SessionRow: View {
    let model: AppModel
    let session: Session

    var body: some View {
        ListRow(session.label, subtitle: subtitle, systemImage: icon) {
            if model.account.isCurrent(session) {
                Text(Copy.Settings.thisDevice)
                    .font(Tokens.Font.caption)
                    .foregroundStyle(Tokens.Color.accent)
            } else {
                IconButton(Copy.Settings.signOutDevice, systemImage: Symbol.signOut, role: .destructive) { revoke() }
            }
        }
    }

    private var icon: String {
        switch session.platform {
        case "mac": return "laptopcomputer"
        case "ipados": return "ipad"
        case "web": return "globe"
        default: return "iphone"
        }
    }

    private var subtitle: String {
        guard let used = session.lastUsedDate else { return Copy.Settings.never }
        return "\(Copy.Settings.lastUsed) \(Copy.relative(used))"
    }

    private func revoke() {
        Task {
            do {
                try await model.account.revoke(session)
                model.show(Copy.Settings.signedOutDevice, kind: .success)
            } catch {
                model.show(Copy.message(for: error) ?? Copy.Common.retry, kind: .error)
            }
        }
    }
}

// MARK: - preferences, about, sign out

private struct PreferencesSection: View {
    @Bindable var model: AppModel

    var body: some View {
        Section {
            Toggle(Copy.Settings.haptics, isOn: $model.hapticsEnabled)
                .tint(Tokens.Color.accent)
            NavigationLink {
                DesignGallery(model: model)
            } label: {
                Label(Copy.Settings.gallery, systemImage: Symbol.gallery)
            }
        }
    }
}

private struct AboutSection: View {
    let model: AppModel

    var body: some View {
        Section(Copy.Settings.about) {
            LabeledContent(Copy.Settings.server, value: AppConfig.apiBase.host() ?? "")
            LabeledContent(Copy.Settings.version, value: model.capabilities.version.isEmpty ? "-" : model.capabilities.version)
        }
        .font(Tokens.Font.body)
    }
}

private struct SignOutSection: View {
    let model: AppModel
    @State private var confirming = false

    var body: some View {
        Section {
            Button(Copy.Settings.signOut, role: .destructive) { confirming = true }
                .buttonStyle(.kit(.danger, fullWidth: true))
                .listRowBackground(Color.clear)
                .confirmationDialog(Copy.Settings.signOutConfirm, isPresented: $confirming, titleVisibility: .visible) {
                    Button(Copy.Settings.signOut, role: .destructive) {
                        Task { await model.signOut() }
                    }
                    Button(Copy.Common.cancel, role: .cancel) {}
                } message: {
                    Text(Copy.Settings.signOutLine)
                }
        }
    }
}
