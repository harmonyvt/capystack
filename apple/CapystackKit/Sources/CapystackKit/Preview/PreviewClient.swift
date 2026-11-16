import Foundation

/// A fake server in memory: the same answers the API gives, no network. Previews, tests and `AppModel.preview` use
/// it. It keeps a change log like D1's `changes` table, so the sync engine runs against it exactly as against the API
/// (including `410 sync.too_old` once `expireChanges(before:)` was called) and honours Idempotency-Key.
public actor PreviewClient: CapystackClient {
    public struct Options: Sendable {
        /// Delay before every answer (previews feel real; tests use zero).
        public var latency: Duration
        /// Every call throws `.network` (offline).
        public var offline: Bool
        /// Every keyed call throws `.signedOut`.
        public var signedOut: Bool
        public var ai: Bool
        public var push: Bool

        public init(latency: Duration = .zero, offline: Bool = false, signedOut: Bool = false, ai: Bool = true, push: Bool = false) {
            self.latency = latency
            self.offline = offline
            self.signedOut = signedOut
            self.ai = ai
            self.push = push
        }
    }

    private struct Change {
        var seq: Int64
        var id: String
        var gone: Bool
    }

    private var options: Options
    private var notes: [String: Note] = [:]
    private var changes: [Change] = []
    private var seq: Int64 = 0
    private var oldestValidSince: Int64 = 0
    private var idempotent: [String: Note?] = [:]
    private var threads: [ChatThread]
    private var messages: [String: [ChatMessage]]
    private var sessionList: [Session]
    private var keyList: [ToolKey]
    private var me: Session
    private var jobs: [String: Job] = [:]
    private var clock: Int64
    private var counter = 0
    /// Every push registration received (tests read it).
    public private(set) var registrations: [PushRegistration] = []
    /// Every write request received, by kind (tests read it).
    public private(set) var writes: [String] = []

    public init(_ options: Options = Options(), data: PreviewData = .standard) {
        self.options = options
        self.threads = data.threads
        self.messages = data.messages
        self.sessionList = data.sessions
        self.keyList = data.keys
        self.me = data.me
        self.clock = PreviewData.base
        for note in data.notes.sorted(by: { $0.updatedAt < $1.updatedAt }) {
            notes[note.id] = note
            seq += 1
            changes.append(Change(seq: seq, id: note.id, gone: false))
        }
    }

    // MARK: - test and preview controls

    public func setOffline(_ offline: Bool) { options.offline = offline }
    public func setSignedOut(_ signedOut: Bool) { options.signedOut = signedOut }

    /// Another device edits a note (it shows up in the next pull).
    public func serverUpsert(_ note: Note) {
        notes[note.id] = note
        record(note.id, gone: false)
    }

    /// Another device deletes a note.
    public func serverDelete(id: String) {
        notes[id] = nil
        record(id, gone: true)
    }

    /// Delete markers before `seq` are forgotten: a pull with an older non-zero `since` answers 410.
    public func expireChanges(before seq: Int64) { oldestValidSince = seq }

    public var serverNotes: [Note] { notes.values.sorted { $0.updatedAt > $1.updatedAt } }
    public var currentSeq: Int64 { seq }

    // MARK: - helpers

    private func record(_ id: String, gone: Bool) {
        seq += 1
        changes.removeAll { $0.id == id }
        changes.append(Change(seq: seq, id: id, gone: gone))
    }

    private func tick() -> Int64 {
        clock += 1_000
        return clock
    }

    private func nextID() -> String {
        counter += 1
        return String(format: "00000000-0000-4000-8000-%012ld", counter)
    }

    private func gate(keyed: Bool = true) async throws {
        if options.latency > .zero { try? await Task.sleep(for: options.latency) }
        if options.offline { throw APIError.network(code: URLError.Code.notConnectedToInternet.rawValue) }
        if keyed && options.signedOut { throw APIError.signedOut }
    }

    private static func notFound() -> APIError { .server(code: APIError.notFound, status: 404, message: nil) }

    // MARK: - system and auth

    public func capabilities() async throws -> Capabilities {
        try await gate(keyed: false)
        return Capabilities(
            name: AppConfig.displayName, version: "preview",
            features: .init(ai: options.ai, push: options.push, posthog: false, mcp: true), posthog: nil)
    }

    public func exchange(code: String, verifier: String, device: String, platform: String) async throws -> SignInResult {
        try await gate(keyed: false)
        options.signedOut = false
        return SignInResult(token: "preview-token-\(code.prefix(6))", session: me)
    }

    public func me() async throws -> Session {
        try await gate()
        return me
    }

    public func sessions() async throws -> [Session] {
        try await gate()
        return sessionList
    }

    public func revokeSession(id: String) async throws {
        try await gate()
        guard sessionList.contains(where: { $0.id == id }) else { throw Self.notFound() }
        sessionList.removeAll { $0.id == id }
    }

    public func signOut() async throws {
        try await gate()
        options.signedOut = true
    }

    public func keys() async throws -> [ToolKey] {
        try await gate()
        return keyList
    }

    public func createKey(name: String) async throws -> CreatedKey {
        try await gate()
        let key = ToolKey(id: "k-\(nextID().suffix(4))", name: name, createdAt: tick(), lastUsedAt: nil)
        keyList.insert(key, at: 0)
        return CreatedKey(key: key, token: "preview_key_0123456789abcdefghijklmnopqrstuvwxyzAB")
    }

    public func revokeKey(id: String) async throws {
        try await gate()
        guard keyList.contains(where: { $0.id == id }) else { throw Self.notFound() }
        keyList.removeAll { $0.id == id }
    }

    // MARK: - notes

    public func listNotes(limit: Int, before: String?) async throws -> NotesPage {
        try await gate()
        let sorted = serverNotes.filter { note in
            guard let before, let cut = Int64(before) else { return true }
            return note.updatedAt < cut
        }
        let page = Array(sorted.prefix(limit))
        let next = sorted.count > limit ? page.last.map { String($0.updatedAt) } : nil
        return NotesPage(notes: page, next: next)
    }

    public func note(id: String) async throws -> Note {
        try await gate()
        guard let note = notes[id] else { throw Self.notFound() }
        return note
    }

    public func createNote(id: String, title: String, body: String, idempotencyKey: String) async throws -> Note? {
        try await gate()
        if let replay = idempotent[idempotencyKey] { return replay }
        writes.append("create")
        let now = tick()
        let note = Note(id: id, title: title, body: body, createdAt: now, updatedAt: now)
        notes[id] = note
        record(id, gone: false)
        idempotent[idempotencyKey] = note
        return note
    }

    public func updateNote(id: String, title: String?, body: String?, idempotencyKey: String) async throws -> Note? {
        try await gate()
        if let replay = idempotent[idempotencyKey] { return replay }
        guard var note = notes[id] else { throw Self.notFound() }
        writes.append("update")
        if let title { note.title = title }
        if let body { note.body = body }
        note.updatedAt = tick()
        notes[id] = note
        record(id, gone: false)
        idempotent[idempotencyKey] = note
        return note
    }

    public func deleteNote(id: String, idempotencyKey: String) async throws {
        try await gate()
        if idempotent[idempotencyKey] != nil { return }
        guard notes[id] != nil else { throw Self.notFound() }
        writes.append("delete")
        notes[id] = nil
        record(id, gone: true)
        idempotent[idempotencyKey] = .some(nil)
    }

    public func summarize(noteID: String) async throws -> String {
        try await gate()
        guard options.ai else { throw APIError.server(code: APIError.aiOff, status: 503, message: nil) }
        guard let note = notes[noteID] else { throw Self.notFound() }
        let words = note.body.split(whereSeparator: { $0 == " " || $0 == "\n" }).count
        return "a short note (\(words) words) about \(note.displayTitle.isEmpty ? "nothing much" : note.displayTitle)."
    }

    // MARK: - sync

    public func pull(since: Int64) async throws -> SyncPage {
        try await gate()
        if since > 0 && since < oldestValidSince {
            throw APIError.server(code: APIError.syncTooOld, status: 410, message: nil)
        }
        let after = changes.filter { $0.seq > since }.sorted { $0.seq < $1.seq }
        let page = Array(after.prefix(500))
        let next = page.last?.seq ?? max(since, 0)
        var pageNotes: [Note] = []
        var gone: [SyncPage.Gone] = []
        for change in page {
            if change.gone {
                gone.append(SyncPage.Gone(entity: "note", id: change.id))
            } else if let note = notes[change.id] {
                pageNotes.append(note)
            }
        }
        return SyncPage(since: since, next: next, more: after.count > page.count, notes: pageNotes, gone: gone)
    }

    // MARK: - chat

    public func chatThreads() async throws -> [ChatThread] {
        try await gate()
        return threads.sorted { $0.updatedAt > $1.updatedAt }
    }

    public func createChatThread(title: String?) async throws -> ChatThread {
        try await gate()
        let now = tick()
        let thread = ChatThread(id: nextID(), title: title ?? "", createdAt: now, updatedAt: now)
        threads.insert(thread, at: 0)
        messages[thread.id] = []
        return thread
    }

    public func chatThread(id: String) async throws -> ChatThreadDetail {
        try await gate()
        guard let thread = threads.first(where: { $0.id == id }) else { throw Self.notFound() }
        return ChatThreadDetail(thread: thread, messages: messages[id] ?? [])
    }

    public func sendChat(threadID: String, text: String) async throws -> [ChatMessage] {
        try await gate()
        guard options.ai else { throw APIError.server(code: APIError.aiOff, status: 503, message: nil) }
        guard let at = threads.firstIndex(where: { $0.id == threadID }) else { throw Self.notFound() }
        let user = ChatMessage(id: nextID(), threadID: threadID, role: "user", text: text, createdAt: tick())
        let count = notes.count
        let reply = ChatMessage(
            id: nextID(), threadID: threadID, role: "assistant",
            text: "you have \(count) \(count == 1 ? "note" : "notes"). this is a preview answer.", createdAt: tick())
        messages[threadID, default: []].append(contentsOf: [user, reply])
        if threads[at].title.isEmpty { threads[at].title = String(text.prefix(40)) }
        threads[at].updatedAt = reply.createdAt
        return [user, reply]
    }

    // MARK: - push and jobs

    public func registerPush(_ registration: PushRegistration) async throws {
        try await gate()
        registrations.append(registration)
    }

    public func unregisterPush(id: String) async throws {
        try await gate()
    }

    public func startDemoJob(seconds: Int?) async throws -> Job {
        try await gate()
        let now = tick()
        let job = Job(id: nextID(), state: .running, progress: 0, title: "demo job", createdAt: now, updatedAt: now)
        jobs[job.id] = job
        return job
    }

    /// Each read moves the job a quarter of the way, so previews and tests finish without real time.
    public func job(id: String) async throws -> Job {
        try await gate()
        guard var job = jobs[id] else { throw Self.notFound() }
        if job.state == .running {
            job.progress = min(1, job.progress + 0.25)
            if job.progress >= 1 { job.state = .done }
            job.updatedAt = tick()
            jobs[id] = job
        }
        return job
    }
}
