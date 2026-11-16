import Foundation

/// The app's identity (docs/CONTRACT.md section 0). `./init` rewrites these literal strings across the repo, so they are
/// spelled exactly like the placeholders and nowhere else.
public enum AppConfig {
    /// The API Worker. Apps talk only to this host after sign-in.
    public static let apiBase = URL(string: "https://capystack-api.capybaraharmony.com")!
    /// The web app behind Cloudflare Access; its Worker mints the one-time sign-in code.
    public static let webBase = URL(string: "https://capystack.capybaraharmony.com")!
    /// The app's URL scheme; sign-in ends on `capystack://signed-in?code=…`.
    public static let urlScheme = "capystack"
    public static let bundleID = "com.capybaraharmony.capystack"
    public static let appGroup = "group.com.capybaraharmony.capystack"
    /// Keychain service for the session token.
    public static let keychainService = "com.capybaraharmony.capystack"
    /// Display name (copy is lowercase).
    public static let displayName = "capystack"
}
