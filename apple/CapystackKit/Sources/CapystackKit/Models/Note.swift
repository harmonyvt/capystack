import Foundation

/// A note (docs/CONTRACT.md section 4): ids are lowercase UUIDs, times are ms since 1970.
public struct Note: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var title: String
    public var body: String
    public var createdAt: Int64
    public var updatedAt: Int64

    enum CodingKeys: String, CodingKey {
        case id, title, body
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(id: String, title: String, body: String, createdAt: Int64, updatedAt: Int64) {
        self.id = id
        self.title = title
        self.body = body
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = try c.decode(String.self, forKey: AnyKey("id"))
        title = Lenient.string(c, "title") ?? ""
        body = Lenient.string(c, "body") ?? ""
        createdAt = Lenient.millis(c, "created_at") ?? 0
        updatedAt = Lenient.millis(c, "updated_at") ?? createdAt
    }

    /// A new lowercase UUID, for a note made offline (the server takes the client's id).
    public static func newID() -> String { UUID().uuidString.lowercased() }

    public var createdDate: Date { Millis.date(createdAt) }
    public var updatedDate: Date { Millis.date(updatedAt) }

    /// The title, or the first line of the body when the title is empty.
    public var displayTitle: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        let firstLine = body.split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init) ?? ""
        return firstLine.trimmingCharacters(in: .whitespaces)
    }
}

/// `GET /notes` (`{notes, next}`). The app lists notes from its sync copy; this is for completeness and tests.
public struct NotesPage: Decodable, Sendable, Equatable {
    public var notes: [Note]
    /// The cursor for `before`, as text whatever the server sends; nil at the end.
    public var next: String?

    public init(notes: [Note], next: String?) {
        self.notes = notes
        self.next = next
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        notes = (try? c.decode([Note].self, forKey: AnyKey("notes"))) ?? []
        next = Lenient.text(c, "next")
    }
}
