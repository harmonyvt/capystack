import Foundation

/// A signed-in device (`kind == "session"`) or a key for tools (`kind == "key"`), as `/auth/me`, `/auth/sessions` and
/// `/auth/exchange` send it.
public struct Session: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var kind: String
    public var name: String
    public var device: String?
    public var platform: String?
    public var createdAt: Int64
    public var lastUsedAt: Int64?
    public var expiresAt: Int64?

    enum CodingKeys: String, CodingKey {
        case id, kind, name, device, platform
        case createdAt = "created_at"
        case lastUsedAt = "last_used_at"
        case expiresAt = "expires_at"
    }

    public init(
        id: String, kind: String = "session", name: String, device: String?, platform: String?,
        createdAt: Int64, lastUsedAt: Int64?, expiresAt: Int64?
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.device = device
        self.platform = platform
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
        self.expiresAt = expiresAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = try c.decode(String.self, forKey: AnyKey("id"))
        kind = Lenient.string(c, "kind") ?? "session"
        name = Lenient.string(c, "name") ?? ""
        device = Lenient.string(c, "device")
        platform = Lenient.string(c, "platform")
        createdAt = Lenient.millis(c, "created_at") ?? 0
        lastUsedAt = Lenient.millis(c, "last_used_at")
        expiresAt = Lenient.millis(c, "expires_at")
    }

    public var isKey: Bool { kind == "key" }
    /// What a row shows: the device's name, else the session's name.
    public var label: String { device.flatMap { $0.isEmpty ? nil : $0 } ?? name }
    public var lastUsedDate: Date? { lastUsedAt.map(Millis.date) }
}

/// A key for tools (MCP, scripts), as `/auth/keys` lists it. The token itself is shown once, at creation.
public struct ToolKey: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var createdAt: Int64
    public var lastUsedAt: Int64?

    enum CodingKeys: String, CodingKey {
        case id, name
        case createdAt = "created_at"
        case lastUsedAt = "last_used_at"
    }

    public init(id: String, name: String, createdAt: Int64, lastUsedAt: Int64?) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = try c.decode(String.self, forKey: AnyKey("id"))
        name = Lenient.string(c, "name") ?? ""
        createdAt = Lenient.millis(c, "created_at") ?? 0
        lastUsedAt = Lenient.millis(c, "last_used_at")
    }

    public var lastUsedDate: Date? { lastUsedAt.map(Millis.date) }
}

/// `POST /auth/keys` → `{key, token}`.
public struct CreatedKey: Decodable, Sendable, Hashable {
    public var key: ToolKey
    public var token: String

    public init(key: ToolKey, token: String) {
        self.key = key
        self.token = token
    }
}

/// `POST /auth/exchange` → `{token, session}`.
public struct SignInResult: Decodable, Sendable, Hashable {
    public var token: String
    public var session: Session

    public init(token: String, session: Session) {
        self.token = token
        self.session = session
    }
}
