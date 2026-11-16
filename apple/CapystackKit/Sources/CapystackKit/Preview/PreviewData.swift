import Foundation

/// The fake server's starting data: a few notes, a chat thread, two signed-in devices and a key for tools.
/// Copy is lowercase, like the app's.
public struct PreviewData: Sendable {
    public var notes: [Note]
    public var threads: [ChatThread]
    public var messages: [String: [ChatMessage]]
    public var sessions: [Session]
    public var keys: [ToolKey]
    /// The session this device holds (`/auth/me`).
    public var me: Session

    public init(
        notes: [Note], threads: [ChatThread], messages: [String: [ChatMessage]], sessions: [Session], keys: [ToolKey],
        me: Session
    ) {
        self.notes = notes
        self.threads = threads
        self.messages = messages
        self.sessions = sessions
        self.keys = keys
        self.me = me
    }

    /// A fixed moment, so previews and tests are stable: 2026-11-16 09:00 UTC.
    public static let base: Int64 = 1_763_283_600_000
    static let minute: Int64 = 60_000
    static let day: Int64 = 86_400_000

    public static let standard: PreviewData = {
        let notes = [
            Note(
                id: "0b7e0f43-8f3a-4c51-9f0e-1c2d3e4f5a01", title: "groceries",
                body: "oat milk\nlemons\nrice\nsomething green", createdAt: base - 3 * day, updatedAt: base - 20 * minute),
            Note(
                id: "0b7e0f43-8f3a-4c51-9f0e-1c2d3e4f5a02", title: "ideas for the weekend",
                body: "walk to the lake, try the new noodle place, finally fix the bike light",
                createdAt: base - 2 * day, updatedAt: base - 2 * 60 * minute),
            Note(
                id: "0b7e0f43-8f3a-4c51-9f0e-1c2d3e4f5a03", title: "release checklist",
                body: "run the gates\nbump the build number\nwrite the notes\nsend to testflight",
                createdAt: base - day, updatedAt: base - day),
            Note(
                id: "0b7e0f43-8f3a-4c51-9f0e-1c2d3e4f5a04", title: "",
                body: "a note with no title shows its first line instead", createdAt: base - 5 * day, updatedAt: base - 5 * day),
        ]
        let thread = ChatThread(
            id: "7c1d2e3f-0000-4000-8000-000000000001", title: "what's on my list", createdAt: base - 30 * minute,
            updatedAt: base - 28 * minute)
        let messages = [
            ChatMessage(
                id: "7c1d2e3f-0000-4000-8000-0000000000a1", threadID: thread.id, role: "user",
                text: "what do i still need to buy?", createdAt: base - 30 * minute),
            ChatMessage(
                id: "7c1d2e3f-0000-4000-8000-0000000000a2", threadID: thread.id, role: "assistant",
                text: "your groceries note has oat milk, lemons, rice and something green.", createdAt: base - 28 * minute),
        ]
        let me = Session(
            id: "s-0001", name: "harmony's iphone", device: "harmony's iphone", platform: "ios",
            createdAt: base - 10 * day, lastUsedAt: base, expiresAt: base + 80 * day)
        let sessions = [
            me,
            Session(
                id: "s-0002", name: "studio mac", device: "studio mac", platform: "mac",
                createdAt: base - 30 * day, lastUsedAt: base - 3 * 60 * minute, expiresAt: base + 60 * day),
            Session(
                id: "s-0003", name: "web", device: "safari", platform: "web",
                createdAt: base - 4 * day, lastUsedAt: base - day, expiresAt: base + 86 * day),
        ]
        let keys = [
            ToolKey(id: "k-0001", name: "claude code", createdAt: base - 7 * day, lastUsedAt: base - 60 * minute),
        ]
        return PreviewData(
            notes: notes, threads: [thread], messages: [thread.id: messages], sessions: sessions, keys: keys, me: me)
    }()

    /// Nothing yet: empty states.
    public static let empty: PreviewData = {
        let s = standard
        return PreviewData(notes: [], threads: [], messages: [:], sessions: [s.me], keys: [], me: s.me)
    }()
}
