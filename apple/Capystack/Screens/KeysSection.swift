import CapystackKit
import SwiftUI

/// Keys for tools (MCP clients, scripts): list, create (the token is shown once), revoke.
struct KeysSection: View {
    let model: AppModel
    @State private var creating = false

    var body: some View {
        Section {
            ForEach(model.account.keys) { key in
                KeyRow(model: model, key: key)
            }
            if model.account.keys.isEmpty && model.account.phase == .ready {
                Text(Copy.Settings.noKeys)
                    .font(Tokens.Font.body)
                    .foregroundStyle(Tokens.Color.textMuted)
            }
            Button {
                creating = true
            } label: {
                Label(Copy.Settings.newKey, systemImage: Symbol.add)
            }
            .buttonStyle(.ghost)
        } header: {
            Text(Copy.Settings.keys)
        } footer: {
            Text(Copy.Settings.keysLine)
        }
        .sheet(isPresented: $creating) {
            NewKeySheet(model: model)
        }
    }
}

private struct KeyRow: View {
    let model: AppModel
    let key: ToolKey

    var body: some View {
        ListRow(key.name, subtitle: subtitle, systemImage: Symbol.key) {
            IconButton(Copy.Settings.revoke, systemImage: Symbol.delete, role: .destructive) { revoke() }
        }
        .privacyMask()
    }

    private var subtitle: String {
        guard let used = key.lastUsedDate else { return Copy.Settings.never }
        return "\(Copy.Settings.lastUsed) \(Copy.relative(used))"
    }

    private func revoke() {
        Task {
            do {
                try await model.account.revoke(key)
                model.show(Copy.Settings.revoked, kind: .success)
            } catch {
                model.show(Copy.message(for: error) ?? Copy.Common.retry, kind: .error)
            }
        }
    }
}

/// Names a new key, then shows its token once with a copy button.
private struct NewKeySheet: View {
    let model: AppModel
    @State private var name = ""
    @State private var made: CreatedKey?
    @State private var working = false
    @State private var copied = false
    @State private var failure: String?

    var body: some View {
        Sheet(title: made == nil ? Copy.Settings.newKey : Copy.Settings.keyMadeTitle) {
            if let made {
                result(made)
            } else {
                form
            }
        }
        .haptic(.success, trigger: copied, when: { $0 })
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            InputField(Copy.Settings.keyName, placeholder: Copy.Settings.keyNamePlaceholder, text: $name, onSubmit: create)
            if let failure {
                Text(failure)
                    .font(Tokens.Font.caption)
                    .foregroundStyle(Tokens.Color.danger)
            }
            Button(Copy.Settings.createKey, action: create)
                .buttonStyle(.kit(.primary, fullWidth: true))
                .disabled(working || name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func result(_ made: CreatedKey) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            Text(Copy.Settings.keyMadeLine)
                .font(Tokens.Font.body)
                .foregroundStyle(Tokens.Color.textMuted)
            Text(made.token)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Tokens.Color.text)
                .textSelection(.enabled)
                .padding(Tokens.Space.s3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous).fill(Tokens.Color.surface))
                .privacyMask()
            Button(copied ? Copy.Settings.copied : Copy.Settings.copy) {
                Clipboard.copy(made.token)
                copied = true
            }
            .buttonStyle(.kit(.secondary, fullWidth: true))
        }
    }

    private func create() {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !working else { return }
        working = true
        failure = nil
        Task {
            do {
                made = try await model.account.createKey(name: clean)
            } catch {
                failure = Copy.message(for: error)
            }
            working = false
        }
    }
}
