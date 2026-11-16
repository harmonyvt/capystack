import SwiftUI

/// The sign-in card: the app's name, one line, one button. `expired` says "sign in again"; `busy` swaps the button's
/// word for a quiet one and turns it off; `error` shows under it.
struct SignInCard: View {
    var expired = false
    var busy = false
    var error: String?
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            Image(systemName: Symbol.notes)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Tokens.Color.accent)
            Text(Copy.SignIn.title)
                .font(Tokens.Font.large)
                .foregroundStyle(Tokens.Color.text)
            Text(expired ? Copy.SignIn.expiredLine : Copy.SignIn.line)
                .font(Tokens.Font.body)
                .foregroundStyle(Tokens.Color.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button(buttonTitle, action: action)
                .buttonStyle(.kit(.primary, fullWidth: true))
                .disabled(busy)
            if let error {
                Text(error)
                    .font(Tokens.Font.caption)
                    .foregroundStyle(Tokens.Color.danger)
            }
        }
        .padding(Tokens.Space.s6)
        .frame(maxWidth: 400)
        .background(RoundedRectangle(cornerRadius: Tokens.Radius.lg, style: .continuous).fill(Tokens.Color.surfaceRaised))
        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.lg, style: .continuous).strokeBorder(Tokens.Color.border, lineWidth: 1))
    }

    private var buttonTitle: String {
        if busy { return Copy.SignIn.working }
        return expired ? Copy.SignIn.again : Copy.SignIn.button
    }
}
