import Foundation

/// `GET /sync?since=N` → `{since, next, more, notes, gone}` (docs/CONTRACT.md section 5).
public struct SyncPage: Decodable, Sendable, Equatable {
    public struct Gone: Decodable, Sendable, Equatable {
        public var entity: String
        public var id: String

        public init(entity: String, id: String) {
            self.entity = entity
            self.id = id
        }
    }

    public var since: Int64
    /// The cursor for the next pull.
    public var next: Int64
    /// More changes wait after `next`: pull again at once.
    public var more: Bool
    public var notes: [Note]
    public var gone: [Gone]

    public init(since: Int64, next: Int64, more: Bool, notes: [Note], gone: [Gone]) {
        self.since = since
        self.next = next
        self.more = more
        self.notes = notes
        self.gone = gone
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        since = Lenient.millis(c, "since") ?? 0
        next = Lenient.millis(c, "next") ?? since
        more = (try? c.decode(Bool.self, forKey: AnyKey("more"))) ?? false
        notes = (try? c.decode([Note].self, forKey: AnyKey("notes"))) ?? []
        gone = (try? c.decode([Gone].self, forKey: AnyKey("gone"))) ?? []
    }

    /// The ids of deleted notes in this page.
    var goneNoteIDs: [String] {
        gone.filter { $0.entity == "note" || $0.entity == "notes" }.map(\.id)
    }
}

/// How a sync pass ended.
public enum SyncOutcome: Sendable, Equatable {
    case ok
    /// Nothing reached the server; the outbox waits.
    case offline
    /// The server refused the token.
    case signedOut
    case failed(APIError)
}

/// One pending write in the outbox.
public struct OutboxOp: Sendable, Equatable {
    public enum Kind: String, Sendable { case create, update, delete }

    public var opID: String
    public var kind: Kind
    public var noteID: String
    /// For `update`, nil means "unchanged".
    public var title: String?
    public var body: String?
    public var idempotencyKey: String
    public var createdAt: Int64
    public var tries: Int
    public var nextAttemptAt: Int64
    /// Handed to the sender and not settled yet: never merged into.
    public var sending: Bool
}
