import Foundation
import SQLite3

public struct NoteDatabaseError: Error, Sendable, Equatable {
    public var message: String
}

/// The on-device copy of the notes and the outbox of writes not yet confirmed (docs/CONTRACT.md section 5).
/// SQLite from the SDK, one connection used only from this actor.
///
/// Tables: `notes` (what the screens show), `outbox` (pending create/update/delete, oldest first, each with its own
/// Idempotency-Key), `meta` (`cursor`: the last `next` from `GET /sync`).
///
/// Rules:
/// - A local write changes `notes` and queues an op in one transaction.
/// - An edit is merged into the newest op for the note when that op was never handed to the sender (`tries == 0`,
///   `sending == 0`), so a burst of keystrokes is one request and a key is never reused with a different body.
/// - A pulled note never overwrites a note with ops still pending (local wins until the server confirms).
public actor NoteDatabase {
    private let connection: Connection
    /// SQLITE_TRANSIENT: sqlite copies bound strings.
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private var db: OpaquePointer? { connection.db }

    /// `path` is a file path, or ":memory:" for tests and previews.
    public init(path: String) throws {
        if path != ":memory:" {
            let folder = URL(fileURLWithPath: path).deletingLastPathComponent()
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        var opened: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        let rc = sqlite3_open_v2(path, &opened, flags, nil)
        guard rc == SQLITE_OK, let opened else {
            let message = opened.map { String(cString: sqlite3_errmsg($0)) } ?? "sqlite \(rc)"
            sqlite3_close(opened)
            throw NoteDatabaseError(message: message)
        }
        connection = Connection(opened)
        if path != ":memory:" { try Self.exec(opened, "PRAGMA journal_mode=WAL") }
        try Self.exec(opened, "PRAGMA busy_timeout=2000")
        try Self.exec(opened, Self.schema)
        // A send the last launch never heard back from: the server may hold it, so it counts as tried (never merged
        // into again) and goes out again under the same key.
        try Self.exec(opened, "UPDATE outbox SET tries = MAX(tries, 1), sending = 0 WHERE sending = 1")
    }

    /// An in-memory database (previews, tests, and the fallback when the file cannot be opened).
    public static func inMemory() -> NoteDatabase {
        // ":memory:" only fails when sqlite itself cannot allocate; there is nothing better to do then.
        try! NoteDatabase(path: ":memory:")
    }

    /// `Application Support/<bundle id>/notes.sqlite`, or in memory when that cannot be opened.
    public static func openDefault() -> NoteDatabase {
        if let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            let file = base.appendingPathComponent(AppConfig.bundleID, isDirectory: true)
                .appendingPathComponent("notes.sqlite", isDirectory: false)
            if let opened = try? NoteDatabase(path: file.path) { return opened }
        }
        return inMemory()
    }

    // MARK: - Reads

    /// Newest first.
    public func notes() throws -> [Note] {
        try queryNotes("SELECT id, title, body, created_at, updated_at FROM notes ORDER BY updated_at DESC, id ASC", id: nil)
    }

    public func note(id: String) throws -> Note? {
        try queryNotes("SELECT id, title, body, created_at, updated_at FROM notes WHERE id = ?", id: id).first
    }

    public func cursor() -> Int64 { Int64(meta("cursor") ?? "0") ?? 0 }

    public func pendingOps() throws -> [OutboxOp] { try readOps() }

    public func pendingCount() -> Int { (try? readOps().count) ?? 0 }

    // MARK: - Local writes

    /// A note made on this device: the row and a `create` op.
    public func create(_ note: Note) throws {
        try transaction {
            try writeNote(note)
            try insertOp(kind: .create, noteID: note.id, title: note.title, body: note.body, at: note.createdAt)
        }
    }

    /// An edit: the row changes, and the edit joins the newest unsent op for the note or becomes an `update` op.
    /// Nil fields are left as they are. Nothing happens for a note that is not here.
    public func update(id: String, title: String?, body: String?, at: Int64) throws {
        try transaction {
            guard var note = try queryNotes(
                "SELECT id, title, body, created_at, updated_at FROM notes WHERE id = ?", id: id).first
            else { return }
            if let title { note.title = title }
            if let body { note.body = body }
            note.updatedAt = at
            try writeNote(note)
            if let newest = try readOps().last(where: { $0.noteID == id }),
               newest.tries == 0, !newest.sending, newest.kind != .delete {
                var merged = newest
                if let title { merged.title = title }
                if let body { merged.body = body }
                try rewriteOp(merged)
            } else {
                try insertOp(kind: .update, noteID: id, title: title, body: body, at: at)
            }
        }
    }

    /// A delete: the row goes. A note whose create never left the device simply disappears with its ops; otherwise
    /// unsent edits are dropped and a `delete` op is queued.
    public func delete(id: String, at: Int64) throws {
        try transaction {
            try removeNote(id)
            let ops = try readOps().filter { $0.noteID == id }
            if ops.contains(where: { $0.kind == .create && $0.tries == 0 && !$0.sending }) {
                for op in ops { try deleteOp(op.opID) }
                return
            }
            for op in ops where op.tries == 0 && !op.sending { try deleteOp(op.opID) }
            try insertOp(kind: .delete, noteID: id, title: nil, body: nil, at: at)
        }
    }

    // MARK: - The sender's side

    /// Marks the op as sending and answers it as stored now (an edit may have joined it since the list was read).
    public func beginSend(_ opID: String) throws -> OutboxOp? {
        var handed: OutboxOp?
        try transaction {
            try run("UPDATE outbox SET sending = 1 WHERE op_id = ?") { stmt in self.bind(stmt, 1, opID) }
            handed = try readOps().first { $0.opID == opID }
        }
        return handed
    }

    /// The server took the op. `serverNote` is its answer: written when no other op for the note is pending.
    public func settle(_ op: OutboxOp, serverNote: Note?) throws {
        try transaction {
            try deleteOp(op.opID)
            guard op.kind != .delete, let serverNote else { return }
            if try readOps().contains(where: { $0.noteID == serverNote.id }) { return }
            try writeNote(serverNote)
        }
    }

    /// The op waits: tried `tries` times, next allowed at `nextAttemptAt` (ms).
    public func retry(_ op: OutboxOp, tries: Int, nextAttemptAt: Int64) throws {
        try run("UPDATE outbox SET tries = ?, next_attempt_at = ?, sending = 0 WHERE op_id = ?") { stmt in
            sqlite3_bind_int64(stmt, 1, Int64(tries))
            sqlite3_bind_int64(stmt, 2, nextAttemptAt)
            self.bind(stmt, 3, op.opID)
        }
    }

    /// The op was never processed (the token was refused): it waits as it was, under the same key.
    public func release(_ op: OutboxOp) throws {
        try run("UPDATE outbox SET sending = 0 WHERE op_id = ?") { stmt in self.bind(stmt, 1, op.opID) }
    }

    /// The server refused the op for good: it leaves the outbox (the caller then asks the server for the note).
    public func drop(_ op: OutboxOp) throws {
        try transaction { try deleteOp(op.opID) }
    }

    /// The server's copy of one note, unless edits for it are pending.
    public func putServerNote(_ note: Note) throws {
        try transaction {
            if try readOps().contains(where: { $0.noteID == note.id }) { return }
            try writeNote(note)
        }
    }

    /// The server says the note is gone, unless edits for it are pending.
    public func removeServerNote(id: String) throws {
        try transaction {
            if try readOps().contains(where: { $0.noteID == id }) { return }
            try removeNote(id)
        }
    }

    // MARK: - Pull

    /// One page: notes and deletes for notes with no pending ops, then the cursor.
    public func apply(_ page: SyncPage) throws {
        try transaction {
            let pending = Set(try readOps().map(\.noteID))
            for note in page.notes where !pending.contains(note.id) {
                try writeNote(note)
            }
            for id in page.goneNoteIDs where !pending.contains(id) {
                try removeNote(id)
            }
            try putMeta("cursor", String(page.next))
        }
    }

    /// `410 sync.too_old`: the copy is dropped (except notes with pending ops) and the next pull starts at 0.
    public func resetForRepull() throws {
        try transaction {
            try exec("DELETE FROM notes WHERE id NOT IN (SELECT note_id FROM outbox)")
            try putMeta("cursor", "0")
        }
    }

    /// Sign-out: the copy and the outbox both go.
    public func wipe() throws {
        try transaction {
            try exec("DELETE FROM notes")
            try exec("DELETE FROM outbox")
            try putMeta("cursor", "0")
        }
    }

    // MARK: - SQL

    /// Closes the connection when the database goes away. `@unchecked` because the pointer is only used on the
    /// actor until this deinit, which runs after that use has ended.
    private final class Connection: @unchecked Sendable {
        let db: OpaquePointer?
        init(_ db: OpaquePointer?) { self.db = db }
        deinit { sqlite3_close(db) }
    }

    private static let schema = """
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_updated ON notes (updated_at);
    CREATE TABLE IF NOT EXISTS outbox (
      op_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      note_id TEXT NOT NULL,
      title TEXT,
      body TEXT,
      idem_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      sending INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS outbox_order ON outbox (created_at);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """

    private func writeNote(_ note: Note) throws {
        let sql = """
        INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
          created_at = excluded.created_at, updated_at = excluded.updated_at
        """
        try run(sql) { stmt in
            self.bind(stmt, 1, note.id)
            self.bind(stmt, 2, note.title)
            self.bind(stmt, 3, note.body)
            sqlite3_bind_int64(stmt, 4, note.createdAt)
            sqlite3_bind_int64(stmt, 5, note.updatedAt)
        }
    }

    private func removeNote(_ id: String) throws {
        try run("DELETE FROM notes WHERE id = ?") { stmt in self.bind(stmt, 1, id) }
    }

    private func queryNotes(_ sql: String, id: String?) throws -> [Note] {
        try query(sql) { stmt in
            if let id { self.bind(stmt, 1, id) }
        } row: { stmt in
            guard let id = self.column(stmt, 0) else { return nil }
            return Note(
                id: id, title: self.column(stmt, 1) ?? "", body: self.column(stmt, 2) ?? "",
                createdAt: sqlite3_column_int64(stmt, 3), updatedAt: sqlite3_column_int64(stmt, 4))
        }
    }

    /// Oldest first; ops stamped the same millisecond keep the order they were queued in (`rowid`).
    private func readOps() throws -> [OutboxOp] {
        let sql = """
        SELECT op_id, kind, note_id, title, body, idem_key, created_at, tries, next_attempt_at, sending
        FROM outbox ORDER BY created_at ASC, rowid ASC
        """
        return try query(sql) { _ in
        } row: { stmt in
            guard let opID = self.column(stmt, 0), let kindRaw = self.column(stmt, 1),
                  let kind = OutboxOp.Kind(rawValue: kindRaw), let noteID = self.column(stmt, 2),
                  let key = self.column(stmt, 5)
            else { return nil }
            return OutboxOp(
                opID: opID, kind: kind, noteID: noteID,
                title: self.column(stmt, 3), body: self.column(stmt, 4), idempotencyKey: key,
                createdAt: sqlite3_column_int64(stmt, 6), tries: Int(sqlite3_column_int64(stmt, 7)),
                nextAttemptAt: sqlite3_column_int64(stmt, 8), sending: sqlite3_column_int64(stmt, 9) != 0)
        }
    }

    private func insertOp(kind: OutboxOp.Kind, noteID: String, title: String?, body: String?, at: Int64) throws {
        let sql = """
        INSERT INTO outbox (op_id, kind, note_id, title, body, idem_key, created_at, tries, next_attempt_at, sending)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
        """
        let opID = UUID().uuidString.lowercased()
        let key = UUID().uuidString.lowercased()
        try run(sql) { stmt in
            self.bind(stmt, 1, opID)
            self.bind(stmt, 2, kind.rawValue)
            self.bind(stmt, 3, noteID)
            self.bindOptional(stmt, 4, title)
            self.bindOptional(stmt, 5, body)
            self.bind(stmt, 6, key)
            sqlite3_bind_int64(stmt, 7, at)
        }
    }

    private func rewriteOp(_ op: OutboxOp) throws {
        try run("UPDATE outbox SET title = ?, body = ? WHERE op_id = ?") { stmt in
            self.bindOptional(stmt, 1, op.title)
            self.bindOptional(stmt, 2, op.body)
            self.bind(stmt, 3, op.opID)
        }
    }

    private func deleteOp(_ opID: String) throws {
        try run("DELETE FROM outbox WHERE op_id = ?") { stmt in self.bind(stmt, 1, opID) }
    }

    private func meta(_ key: String) -> String? {
        let rows: [String]? = try? query("SELECT value FROM meta WHERE key = ?") { stmt in
            self.bind(stmt, 1, key)
        } row: { stmt in
            self.column(stmt, 0)
        }
        return rows?.first
    }

    private func putMeta(_ key: String, _ value: String) throws {
        try run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value") { stmt in
            self.bind(stmt, 1, key)
            self.bind(stmt, 2, value)
        }
    }

    /// Runs `body` in one transaction. Not nested: public methods call it once and private helpers never do.
    private func transaction(_ body: () throws -> Void) throws {
        try exec("BEGIN IMMEDIATE")
        do {
            try body()
            try exec("COMMIT")
        } catch {
            try? exec("ROLLBACK")
            throw error
        }
    }

    private func exec(_ sql: String) throws {
        guard let db else { throw NoteDatabaseError(message: "database is closed") }
        try Self.exec(db, sql)
    }

    private static func exec(_ db: OpaquePointer, _ sql: String) throws {
        var error: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(db, sql, nil, nil, &error)
        if rc != SQLITE_OK {
            let message = error.map { String(cString: $0) } ?? "sqlite \(rc)"
            sqlite3_free(error)
            throw NoteDatabaseError(message: message)
        }
    }

    private func run(_ sql: String, bind bindBlock: (OpaquePointer?) -> Void) throws {
        guard let db else { throw NoteDatabaseError(message: "database is closed") }
        var stmt: OpaquePointer?
        try check(sqlite3_prepare_v2(db, sql, -1, &stmt, nil))
        defer { sqlite3_finalize(stmt) }
        bindBlock(stmt)
        let rc = sqlite3_step(stmt)
        if rc != SQLITE_DONE && rc != SQLITE_ROW { try check(rc) }
    }

    private func query<T>(_ sql: String, bind bindBlock: (OpaquePointer?) -> Void, row: (OpaquePointer?) -> T?) throws -> [T] {
        guard let db else { throw NoteDatabaseError(message: "database is closed") }
        var stmt: OpaquePointer?
        try check(sqlite3_prepare_v2(db, sql, -1, &stmt, nil))
        defer { sqlite3_finalize(stmt) }
        bindBlock(stmt)
        var out: [T] = []
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { try check(rc); break }
            if let value = row(stmt) { out.append(value) }
        }
        return out
    }

    private func check(_ rc: Int32) throws {
        guard rc == SQLITE_OK || rc == SQLITE_DONE || rc == SQLITE_ROW else {
            let message = db.flatMap { sqlite3_errmsg($0) }.map { String(cString: $0) } ?? "sqlite \(rc)"
            throw NoteDatabaseError(message: message)
        }
    }

    private func bind(_ stmt: OpaquePointer?, _ index: Int32, _ value: String) {
        _ = value.withCString { cString in
            sqlite3_bind_text(stmt, index, cString, -1, transient)
        }
    }

    private func bindOptional(_ stmt: OpaquePointer?, _ index: Int32, _ value: String?) {
        if let value { bind(stmt, index, value) } else { sqlite3_bind_null(stmt, index) }
    }

    private func column(_ stmt: OpaquePointer?, _ index: Int32) -> String? {
        guard sqlite3_column_type(stmt, index) != SQLITE_NULL, let raw = sqlite3_column_text(stmt, index) else { return nil }
        return String(cString: raw)
    }
}
