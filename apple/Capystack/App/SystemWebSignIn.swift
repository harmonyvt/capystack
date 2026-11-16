import AuthenticationServices
import CapystackKit
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Cloudflare Access in SwiftUI's web authentication session (ASWebAuthenticationSession underneath): the system sheet
/// on iPhone and iPad, its window on the Mac. Not ephemeral, so Access's cookie is reused and a second sign-in is usually
/// one tap. Closing the sheet is `SignInError.cancelled`.
@MainActor
struct SystemWebSignIn: WebSignIn {
    let session: WebAuthenticationSession

    func open(_ url: URL, callbackScheme: String) async throws -> URL {
        do {
            return try await session.authenticate(using: url, callbackURLScheme: callbackScheme)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            throw SignInError.cancelled
        }
    }
}

/// Copies text to the system clipboard.
@MainActor
enum Clipboard {
    static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}
