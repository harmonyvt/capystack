import Foundation

/// `GET /capabilities` (open): what this server can do, and the PostHog project the apps report to.
public struct Capabilities: Codable, Sendable, Equatable {
    public struct Features: Codable, Sendable, Equatable {
        public var ai: Bool
        public var push: Bool
        public var posthog: Bool
        public var mcp: Bool

        public init(ai: Bool = false, push: Bool = false, posthog: Bool = false, mcp: Bool = false) {
            self.ai = ai
            self.push = push
            self.posthog = posthog
            self.mcp = mcp
        }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            ai = (try? c.decode(Bool.self, forKey: AnyKey("ai"))) ?? false
            push = (try? c.decode(Bool.self, forKey: AnyKey("push"))) ?? false
            posthog = (try? c.decode(Bool.self, forKey: AnyKey("posthog"))) ?? false
            mcp = (try? c.decode(Bool.self, forKey: AnyKey("mcp"))) ?? false
        }
    }

    public struct PostHog: Codable, Sendable, Equatable {
        public var host: String
        public var token: String

        public init(host: String, token: String) {
            self.host = host
            self.token = token
        }
    }

    public var name: String
    public var version: String
    public var features: Features
    public var posthog: PostHog?

    public init(name: String, version: String, features: Features, posthog: PostHog?) {
        self.name = name
        self.version = version
        self.features = features
        self.posthog = posthog
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        name = Lenient.string(c, "name") ?? AppConfig.displayName
        version = Lenient.string(c, "version") ?? ""
        features = (try? c.decode(Features.self, forKey: AnyKey("features"))) ?? Features()
        posthog = try? c.decode(PostHog.self, forKey: AnyKey("posthog"))
    }

    /// Before the server answered (or offline): everything optional is off.
    public static let unknown = Capabilities(name: AppConfig.displayName, version: "", features: Features(), posthog: nil)

    /// The PostHog project to start, when the feature is on and the token and an https host are set.
    public var postHogProject: (token: String, host: URL)? {
        guard features.posthog, let ph = posthog else { return nil }
        let token = ph.token.trimmingCharacters(in: .whitespaces)
        guard !token.isEmpty, let host = URL(string: ph.host), host.scheme == "https" else { return nil }
        return (token, host)
    }
}
