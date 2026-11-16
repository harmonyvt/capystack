import CryptoKit
import Foundation
import Security
#if canImport(UIKit)
import UIKit
#endif
#if os(macOS)
import SystemConfiguration
#endif

// App sign-in (docs/CONTRACT.md section 3, as cobalt's AccountAuth): a PKCE pair, Cloudflare Access in a web sheet
// (ASWebAuthenticationSession through SwiftUI's WebAuthenticationSession), a one-time code back on
// `capystack://signed-in?code=…`, then `POST /auth/exchange` for this device's token.

/// The pure parts of sign-in: the verifier and its challenge, the page the sheet opens, the code it returns.
public enum AccountAuth {
    public static let callbackScheme = AppConfig.urlScheme
    static let callbackHost = "signed-in"

    /// 32 random bytes, base64url without padding (43 characters).
    public static func makeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            var rng = SystemRandomNumberGenerator()
            for i in bytes.indices { bytes[i] = UInt8.random(in: .min ... .max, using: &rng) }
        }
        return base64url(Data(bytes))
    }

    /// PKCE S256: base64url(SHA-256(verifier)), no padding.
    public static func challenge(for verifier: String) -> String {
        base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// `https://capystack.capybaraharmony.com/api/auth/app?challenge=…&platform=…&device=…`, every value percent-encoded
    /// (a `+` in a device name too, so the server never reads it as a space).
    public static func startURL(base: URL = AppConfig.webBase, platform: String, device: String, challenge: String) -> URL? {
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        let path = comps.path.hasSuffix("/") ? String(comps.path.dropLast()) : comps.path
        comps.percentEncodedPath = path + "/api/auth/app"
        comps.percentEncodedQuery = [("challenge", challenge), ("platform", platform), ("device", device)]
            .map { "\($0.0)=\(encode($0.1))" }
            .joined(separator: "&")
        return comps.url
    }

    private static func encode(_ s: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=#?/'")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }

    /// The one-time code from `capystack://signed-in?code=<base64url>`; nil for any other URL.
    public static func code(from url: URL) -> String? {
        guard isCallback(url),
              let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value,
              (8...256).contains(code.count),
              code.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
        else { return nil }
        return code
    }

    /// Whether a link that reached the app is the sign-in's return (the sheet normally keeps it).
    public static func isCallback(_ url: URL) -> Bool {
        url.scheme?.lowercased() == callbackScheme && url.host(percentEncoded: false)?.lowercased() == callbackHost
    }
}

/// What the server is told about this device: `platform` (`ios`, `ipados`, `mac`) and a lowercase name.
public struct AccountDevice: Sendable, Equatable {
    public var platform: String
    public var name: String

    public init(platform: String, name: String) {
        self.platform = platform
        self.name = name
    }

    @MainActor public static var current: AccountDevice {
        #if os(macOS)
        let raw = SCDynamicStoreCopyComputerName(nil, nil) as String?
        return AccountDevice(platform: "mac", name: clean(raw, fallback: "mac"))
        #elseif canImport(UIKit)
        let device = UIDevice.current
        let pad = device.userInterfaceIdiom == .pad
        // since iOS 16 `name` is the model ("iPhone") unless the app has the user-assigned-name entitlement
        let named = device.name.caseInsensitiveCompare(device.model) == .orderedSame ? nil : device.name
        return AccountDevice(platform: pad ? "ipados" : "ios", name: clean(named, fallback: pad ? "ipad" : "iphone"))
        #else
        return AccountDevice(platform: "ios", name: "iphone")
        #endif
    }

    /// Lowercased, control characters and surrounding spaces dropped, cut to 40 UTF-16 units; `fallback` when empty.
    static func clean(_ raw: String?, fallback: String) -> String {
        guard let raw else { return fallback }
        let scalars = raw.lowercased().unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
        var text = String(String.UnicodeScalarView(scalars)).trimmingCharacters(in: .whitespacesAndNewlines)
        while text.utf16.count > 40 { text.removeLast() }
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? fallback : text
    }
}

/// Why a sign-in did not finish.
public enum SignInError: Error, Sendable, Equatable {
    /// The owner closed the sheet.
    case cancelled
    /// The sheet came back without a usable code.
    case badCallback
    /// The token could not be kept on this device.
    case couldNotSave
    /// The exchange failed.
    case failed(APIError)
}

/// The web sheet that runs Cloudflare Access: opens `url`, answers the URL it ended on. The app passes one wrapping
/// SwiftUI's `WebAuthenticationSession`; previews and tests pass `PreviewWebSignIn`. Closing the sheet throws
/// `SignInError.cancelled`.
@MainActor
public protocol WebSignIn {
    func open(_ url: URL, callbackScheme: String) async throws -> URL
}

/// A sheet that "signs in" after a moment without any network.
@MainActor
public struct PreviewWebSignIn: WebSignIn {
    public enum Outcome: Sendable, Equatable { case signedIn, cancelled, broken }

    public var outcome: Outcome
    public var seconds: Double

    public init(outcome: Outcome = .signedIn, seconds: Double = 0.8) {
        self.outcome = outcome
        self.seconds = seconds
    }

    public func open(_ url: URL, callbackScheme: String) async throws -> URL {
        if seconds > 0 { try? await Task.sleep(for: .seconds(seconds)) }
        switch outcome {
        case .signedIn: return URL(string: "\(callbackScheme)://signed-in?code=PrEvIeW-c0de_0123456789abcdefghijklmnopqr")!
        case .cancelled: throw SignInError.cancelled
        case .broken: return URL(string: "\(callbackScheme)://signed-in")!
        }
    }
}
