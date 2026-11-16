import Foundation

/// A server job (`POST /jobs/demo`, `GET /jobs/:id`).
public struct Job: Codable, Sendable, Hashable, Identifiable {
    public enum State: String, Codable, Sendable {
        case running, done, failed
    }

    public var id: String
    public var kind: String
    public var state: State
    /// 0...1.
    public var progress: Double
    public var title: String
    public var createdAt: Int64
    public var updatedAt: Int64

    enum CodingKeys: String, CodingKey {
        case id, kind, state, progress, title
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(id: String, kind: String = "demo", state: State, progress: Double, title: String, createdAt: Int64, updatedAt: Int64) {
        self.id = id
        self.kind = kind
        self.state = state
        self.progress = progress
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = try c.decode(String.self, forKey: AnyKey("id"))
        kind = Lenient.string(c, "kind") ?? "demo"
        // An unknown state reads as running: the next poll or push settles it.
        state = Lenient.string(c, "state").flatMap(State.init(rawValue:)) ?? .running
        progress = min(1, max(0, (try? c.decode(Double.self, forKey: AnyKey("progress"))) ?? 0))
        title = Lenient.string(c, "title") ?? ""
        createdAt = Lenient.millis(c, "created_at") ?? 0
        updatedAt = Lenient.millis(c, "updated_at") ?? createdAt
    }

    public var isFinished: Bool { state != .running }
}
