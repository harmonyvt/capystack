import SwiftUI

/// What a screen shows when there is nothing in it yet: an icon, a line of title, a line of help, maybe one action.
struct EmptyState: View {
    let systemImage: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    init(systemImage: String, title: String, message: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.systemImage = systemImage
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        VStack(spacing: Tokens.Space.s3) {
            Image(systemName: systemImage)
                .font(.system(size: 36, weight: .regular))
                .foregroundStyle(Tokens.Color.textMuted)
            Text(title)
                .font(Tokens.Font.headline)
                .foregroundStyle(Tokens.Color.text)
            Text(message)
                .font(Tokens.Font.body)
                .foregroundStyle(Tokens.Color.textMuted)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.primary)
                    .padding(.top, Tokens.Space.s2)
            }
        }
        .padding(Tokens.Space.s7)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
