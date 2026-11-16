import Foundation
import Observation

/// The notes screens' state, offline-first: every read comes from the on-device copy (`NoteDatabase`), every write
/// lands there first and goes out through the outbox (`SyncEngine`).
@MainActor @Observable
public final class NotesModel {
    public enum Phase: Sendable, Equatable { case loading, ready }

    public private(set) var notes: [Note] = []
    public private(set) var phase: Phase = .loading
    public private(set) var syncing = false
    /// Writes not yet confirmed by the server.
    public private(set) var pending = 0
    public private(set) var lastOutcome: SyncOutcome = .ok

    @ObservationIgnored let database: NoteDatabase
    @ObservationIgnored let engine: SyncEngine
    @ObservationIgnored private let client: any CapystackClient
    /// Set by `AppModel`: the server refused the token during a sync.
    @ObservationIgnored var onSignedOut: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false

    init(database: NoteDatabase, client: any CapystackClient) {
        self.database = database
        self.client = client
        self.engine = SyncEngine(database: database, client: client)
    }

    /// Reads the copy and hooks the engine up. Cheap to call again.
    public func load() async {
        if !started {
            started = true
            await engine.setOnChange { [weak self] in
                await self?.reload()
            }
        }
        await reload()
    }

    /// Sends the outbox and pulls (pull-to-refresh, foreground, a `device` push).
    public func sync() async {
        syncing = true
        let outcome = await engine.syncNow()
        syncing = false
        lastOutcome = outcome
        await reload()
        if outcome == .signedOut { onSignedOut?() }
    }

    public func note(id: String) -> Note? { notes.first { $0.id == id } }

    /// A new note, saved on the device at once and sent when the server can be reached.
    @discardableResult
    public func create(title: String = "", body: String = "") async -> Note? {
        let now = Millis.now()
        let note = Note(id: Note.newID(), title: title, body: body, createdAt: now, updatedAt: now)
        do {
            try await database.create(note)
        } catch {
            return nil
        }
        await reload()
        syncSoon()
        return note
    }

    /// Saves an edit. Only changed fields are sent.
    public func update(id: String, title: String, body: String) async {
        guard let current = note(id: id) else { return }
        let newTitle = current.title == title ? nil : title
        let newBody = current.body == body ? nil : body
        guard newTitle != nil || newBody != nil else { return }
        try? await database.update(id: id, title: newTitle, body: newBody, at: Millis.now())
        await reload()
        syncSoon()
    }

    public func delete(id: String) async {
        try? await database.delete(id: id, at: Millis.now())
        await reload()
        syncSoon()
    }

    /// `POST /notes/:id/summarize` (online only; throws `ai.off` when the server has no model).
    public func summarize(id: String) async throws -> String {
        try await client.summarize(noteID: id)
    }

    // MARK: - internal

    func reload() async {
        notes = (try? await database.notes()) ?? []
        pending = await database.pendingCount()
        phase = .ready
    }

    /// Sign-out: the copy and the outbox go.
    func wipe() async {
        await engine.cancelWake()
        try? await database.wipe()
        notes = []
        pending = 0
        lastOutcome = .ok
    }

    private func syncSoon() {
        Task { await self.sync() }
    }
}
