import Foundation
import Testing
@testable import CapystackKit

// Values are read into locals before `#expect`, so no macro argument carries `try` or `await`.

private func note(_ id: String, _ title: String = "t", at: Int64 = 1) -> Note {
    Note(id: id, title: title, body: "b", createdAt: at, updatedAt: at)
}

@Suite struct NoteDatabaseTests {
    @Test func createQueuesAnOp() async throws {
        let db = NoteDatabase.inMemory()
        try await db.create(note("a"))
        let notes = try await db.notes()
        let ops = try await db.pendingOps()
        #expect(notes.map(\.id) == ["a"])
        #expect(ops.count == 1)
        #expect(ops.first?.kind == .create)
        #expect(ops.first?.title == "t")
    }

    @Test func editsMergeIntoAnUnsentOp() async throws {
        let db = NoteDatabase.inMemory()
        try await db.create(note("a"))
        try await db.update(id: "a", title: "new", body: nil, at: 2)
        try await db.update(id: "a", title: nil, body: "words", at: 3)
        let ops = try await db.pendingOps()
        let stored = try await db.note(id: "a")
        #expect(ops.count == 1)
        #expect(ops.first?.kind == .create)
        #expect(ops.first?.title == "new")
        #expect(ops.first?.body == "words")
        #expect(stored?.updatedAt == 3)
    }

    @Test func anOpBeingSentIsNeverRewritten() async throws {
        let db = NoteDatabase.inMemory()
        try await db.create(note("a"))
        let before = try await db.pendingOps()
        let first = try #require(before.first)
        _ = try await db.beginSend(first.opID)
        try await db.update(id: "a", title: "later", body: nil, at: 2)
        let ops = try await db.pendingOps()
        #expect(ops.count == 2)
        #expect(ops.first?.title == "t")
        #expect(ops.last?.kind == .update)
        #expect(ops.last?.title == "later")
        #expect(ops.last?.body == nil)
        #expect(ops.first?.idempotencyKey != ops.last?.idempotencyKey)
    }

    @Test func deletingAnUnsentNoteLeavesNoTrace() async throws {
        let db = NoteDatabase.inMemory()
        try await db.create(note("a"))
        try await db.delete(id: "a", at: 2)
        let ops = try await db.pendingOps()
        let notes = try await db.notes()
        #expect(ops.isEmpty)
        #expect(notes.isEmpty)
    }

    @Test func deletingASyncedNoteQueuesADelete() async throws {
        let db = NoteDatabase.inMemory()
        try await db.apply(SyncPage(since: 0, next: 1, more: false, notes: [note("a")], gone: []))
        try await db.update(id: "a", title: "x", body: nil, at: 2)
        try await db.delete(id: "a", at: 3)
        let ops = try await db.pendingOps()
        #expect(ops.map(\.kind) == [.delete])
    }

    @Test func pulledNotesNeverOverwritePendingEdits() async throws {
        let db = NoteDatabase.inMemory()
        try await db.apply(SyncPage(since: 0, next: 1, more: false, notes: [note("a", "server"), note("b")], gone: []))
        try await db.update(id: "a", title: "mine", body: nil, at: 5)
        let page = SyncPage(since: 1, next: 3, more: false, notes: [note("a", "server again")], gone: [.init(entity: "note", id: "b")])
        try await db.apply(page)
        let a = try await db.note(id: "a")
        let b = try await db.note(id: "b")
        let cursor = await db.cursor()
        #expect(a?.title == "mine")
        #expect(b == nil)
        #expect(cursor == 3)
    }

    @Test func resetKeepsPendingNotes() async throws {
        let db = NoteDatabase.inMemory()
        try await db.apply(SyncPage(since: 0, next: 4, more: false, notes: [note("a"), note("b")], gone: []))
        try await db.create(note("c"))
        try await db.resetForRepull()
        let kept = try await db.notes()
        let cursor = await db.cursor()
        #expect(kept.map(\.id) == ["c"])
        #expect(cursor == 0)
        try await db.wipe()
        let after = try await db.notes()
        let ops = try await db.pendingOps()
        #expect(after.isEmpty)
        #expect(ops.isEmpty)
    }

    @Test func fileDatabaseSurvivesReopen() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("capystack-test-\(UUID().uuidString)")
        let path = folder.appendingPathComponent("notes.sqlite").path
        defer { try? FileManager.default.removeItem(at: folder) }
        do {
            let db = try NoteDatabase(path: path)
            try await db.create(note("a"))
            let ops = try await db.pendingOps()
            let first = try #require(ops.first)
            _ = try await db.beginSend(first.opID)
        }
        let again = try NoteDatabase(path: path)
        let ops = try await again.pendingOps()
        // a send never heard back from counts as tried and is no longer "sending"
        #expect(ops.count == 1)
        #expect(ops.first?.tries == 1)
        #expect(ops.first?.sending == false)
    }
}

@Suite struct SyncEngineTests {
    private func setUp(_ options: PreviewClient.Options = .init(), data: PreviewData = .empty) -> (NoteDatabase, PreviewClient, SyncEngine) {
        let db = NoteDatabase.inMemory()
        let client = PreviewClient(options, data: data)
        return (db, client, SyncEngine(database: db, client: client))
    }

    @Test func firstPullFillsTheCopy() async throws {
        let (db, _, engine) = setUp(data: .standard)
        let outcome = await engine.syncNow()
        let notes = try await db.notes()
        #expect(outcome == .ok)
        #expect(notes.count == PreviewData.standard.notes.count)
    }

    @Test func offlineWritesWaitThenGoOut() async throws {
        let (db, client, engine) = setUp(.init(offline: true))
        try await db.create(note("a"))
        let first = await engine.syncNow()
        await engine.cancelWake()
        let waiting = try await db.pendingOps()
        #expect(first == .offline)
        #expect(waiting.count == 1)
        #expect(waiting.first?.tries == 1)

        await client.setOffline(false)
        // the retry waits for its backoff; an engine whose clock is past it sends at once
        let later = SyncEngine(database: db, client: client, now: { Millis.now() + 600_000 })
        let second = await later.syncNow()
        let left = try await db.pendingOps()
        let server = await client.serverNotes
        #expect(second == .ok)
        #expect(left.isEmpty)
        #expect(server.map(\.id) == ["a"])
    }

    @Test func idempotencyKeyMakesARetryHarmless() async throws {
        let (db, client, engine) = setUp()
        try await db.create(note("a"))
        let ops = try await db.pendingOps()
        let op = try #require(ops.first)
        // the server already took this op once (the answer was lost)
        _ = try await client.createNote(id: "a", title: "t", body: "b", idempotencyKey: op.idempotencyKey)
        let outcome = await engine.syncNow()
        let writes = await client.writes
        #expect(outcome == .ok)
        #expect(writes == ["create"])
    }

    @Test func otherDevicesChangesArrive() async throws {
        let (db, client, engine) = setUp(data: .standard)
        await engine.syncNow()
        let first = PreviewData.standard.notes[0]
        let second = PreviewData.standard.notes[1]
        await client.serverUpsert(Note(id: first.id, title: "renamed", body: "", createdAt: 1, updatedAt: 99))
        await client.serverDelete(id: second.id)
        await engine.syncNow()
        let renamed = try await db.note(id: first.id)
        let deleted = try await db.note(id: second.id)
        #expect(renamed?.title == "renamed")
        #expect(deleted == nil)
    }

    @Test func tooOldCursorStartsOver() async throws {
        let (db, client, engine) = setUp(data: .standard)
        await engine.syncNow()
        let cursor = await db.cursor()
        await client.serverUpsert(note("fresh"))
        await client.expireChanges(before: cursor + 100)
        let outcome = await engine.syncNow()
        let fresh = try await db.note(id: "fresh")
        let all = try await db.notes()
        #expect(outcome == .ok)
        #expect(fresh != nil)
        #expect(all.count == PreviewData.standard.notes.count + 1)
    }

    @Test func refusedUpdateTakesTheServersCopy() async throws {
        let (db, client, engine) = setUp(data: .standard)
        await engine.syncNow()
        let target = PreviewData.standard.notes[0]
        try await db.update(id: target.id, title: "edited", body: nil, at: 5)
        await client.serverDelete(id: target.id)          // the update now answers 404: refused for good
        let outcome = await engine.syncNow()
        let ops = try await db.pendingOps()
        let gone = try await db.note(id: target.id)
        #expect(outcome == .ok)
        #expect(ops.isEmpty)
        #expect(gone == nil)
    }

    @Test func signedOutStopsThePassAndKeepsTheOutbox() async throws {
        let (db, client, engine) = setUp()
        try await db.create(note("a"))
        await client.setSignedOut(true)
        let outcome = await engine.syncNow()
        let ops = try await db.pendingOps()
        #expect(outcome == .signedOut)
        #expect(ops.count == 1)
        #expect(ops.first?.tries == 0)
        #expect(ops.first?.sending == false)
    }

    @Test func backoffGrowsAndCaps() {
        #expect(SyncEngine.backoff(tries: 1) == 2_000)
        #expect(SyncEngine.backoff(tries: 3) == 8_000)
        #expect(SyncEngine.backoff(tries: 30) == 300_000)
    }
}
