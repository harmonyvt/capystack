import CapystackKit
import SwiftUI

/// First launch, or "sign in again" after the server refused the token.
struct SignInScreen: View {
    let model: AppModel
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var failure: String?

    var body: some View {
        ZStack {
            Tokens.Color.bg.ignoresSafeArea()
            SignInCard(expired: model.auth == .expired, busy: model.signingIn, error: failure) { start() }
                .padding(Tokens.Space.s5)
        }
        .haptic(.error, trigger: failure, when: { $0 != nil })
        .onAppear { Analytics.screen("sign in") }
    }

    private func start() {
        failure = nil
        let web: any WebSignIn = model.isPreview ? PreviewWebSignIn() : SystemWebSignIn(session: webAuthenticationSession)
        Task {
            do {
                try await model.signIn(using: web)
            } catch {
                failure = Copy.message(for: error)
            }
        }
    }
}
