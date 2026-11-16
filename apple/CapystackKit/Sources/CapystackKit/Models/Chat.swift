import Foundation

/// A chat thread (`chat_threads`).
public struct ChatThread: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var title: String
    public var createdAt: Int64
    public var updatedAt: Int64

    enum CodingKeys: String, CodingKey {
        case id, title
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(id: String, title: String, createdAt: Int64, updatedAt: Int64) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = try c.decode(String.self, forKey: AnyKey("id"))
        title = Lenient.string(c, "title") ?? ""
        createdAt = Lenient.millis(c, "created_at") ?? 0
        updatedAt = Lenient.millis(c, "updated_at") ?? createdAt
    }

    public var updatedDate: Date { Millis.date(updatedAt) }
}

/// One message of a thread. The contract stores `content_json` (Anthropic content blocks) and does not pin the wire
/// shape, so the decoder takes the text from `text`, a string `content`, a block array `content`, or `content_json`
/// (a JSON string of either). Tool calls and results carry no text: `isVisible` is false for them.
public struct ChatMessage: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var threadID: String?
    /// `user` or `assistant` (anything else is shown as the assistant's).
    public var role: String
    public var text: String
    public var createdAt: Int64

    public init(id: String, threadID: String?, role: String, text: String, createdAt: Int64) {
        self.id = id
        self.threadID = threadID
        self.role = role
        self.text = text
        self.createdAt = createdAt
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        id = try c.decode(String.self, forKey: AnyKey("id"))
        threadID = Lenient.string(c, "thread_id")
        role = Lenient.string(c, "role") ?? "assistant"
        createdAt = Lenient.millis(c, "created_at") ?? 0
        if let t = Lenient.string(c, "text") {
            text = t
        } else if let s = Lenient.string(c, "content") {
            text = s
        } else if let blocks = try? c.decode([ContentBlock].self, forKey: AnyKey("content")) {
            text = ContentBlock.text(of: blocks)
        } else if let raw = Lenient.string(c, "content_json") {
            text = ChatMessage.text(fromJSON: raw)
        } else {
            text = ""
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: AnyKey.self)
        try c.encode(id, forKey: AnyKey("id"))
        try c.encodeIfPresent(threadID, forKey: AnyKey("thread_id"))
        try c.encode(role, forKey: AnyKey("role"))
        try c.encode(text, forKey: AnyKey("text"))
        try c.encode(createdAt, forKey: AnyKey("created_at"))
    }

    public var isUser: Bool { role == "user" }
    /// Shown in the thread: a user or assistant message with words in it.
    public var isVisible: Bool {
        (role == "user" || role == "assistant") && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func text(fromJSON raw: String) -> String {
        let data = Data(raw.utf8)
        if let blocks = try? JSONDecoder().decode([ContentBlock].self, from: data) { return ContentBlock.text(of: blocks) }
        if let string = try? JSONDecoder().decode(String.self, from: data) { return string }
        return raw
    }
}

/// An Anthropic content block; only `text` blocks carry words.
struct ContentBlock: Decodable, Sendable {
    var type: String?
    var text: String?

    static func text(of blocks: [ContentBlock]) -> String {
        blocks.compactMap { ($0.type == nil || $0.type == "text") ? $0.text : nil }.joined(separator: "\n")
    }
}

/// `GET /chat/threads/:id` → `{thread, messages}`.
public struct ChatThreadDetail: Decodable, Sendable, Hashable {
    public var thread: ChatThread
    public var messages: [ChatMessage]

    public init(thread: ChatThread, messages: [ChatMessage]) {
        self.thread = thread
        self.messages = messages
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        thread = try c.decode(ChatThread.self, forKey: AnyKey("thread"))
        messages = (try? c.decode([ChatMessage].self, forKey: AnyKey("messages"))) ?? []
    }
}
