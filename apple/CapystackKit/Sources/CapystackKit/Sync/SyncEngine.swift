import Foundation

/// Sends the outbox (oldest first, each op with its own Idempotency-Key), then pulls `GET /sync?since=` until `more`
/// is false (docs/CONTRACT.md section 5). One pass at a time: a call that arrives while a pass runs waits for it, and
/// another pass runs after it so nothing asked for in between is lost.
public actor SyncEngine {
    public let database: NoteDatabase
    private let client: any CapystackClient
    private let now: @Sendable () -> Int64
    private var running = false
    private var again = false
    private var waiters: [CheckedContinuation<SyncOutcome, Never>] = []
    private var wake: Task<Void, Never>?
    private var onChange: (@Sendable () async -> Void)?

    /// Most pages read in one pass (500 changes each).
    static let maxPages = 1_000

    public init(database: NoteDatabase, client: any CapystackClient, now: @escaping @Sendable () -> Int64 = { Millis.now() }) {
        self.database = database
        self.client = client
        self.now = now
    }

    /// Called after every applied page and at the end of each pass, so the screen re-reads the copy.
    public func setOnChange(_ handler: (@Sendable () async -> Void)?) {
        onChange = handler
    }

    /// Runs a pass now (or joins the one running) and answers how it ended.
    @discardableResult
    public func syncNow() async -> SyncOutcome {
        if running {
            again = true
            return await withCheckedContinuation { (continuation: CheckedContinuation<SyncOutcome, Never>) in
                waiters.append(continuation)
            }
        }
        running = true
        var outcome = SyncOutcome.ok
        repeat {
            again = false
            outcome = await pass()
        } while again && outcome == .ok
        running = false
        let done = waiters
        waiters.removeAll()
        for waiter in done { waiter.resume(returning: outcome) }
        return outcome
    }

    /// Stops a scheduled retry (sign-out).
    public func cancelWake() {
        wake?.cancel()
        wake = nil
    }

    // MARK: - one pass

    private func pass() async -> SyncOutcome {
        let outcome: SyncOutcome
        do {
            try await push()
            try await pull()
            outcome = .ok
        } catch let error as APIError {
            if error == .signedOut {
                outcome = .signedOut
            } else if error.isOffline {
                outcome = .offline
            } else {
                outcome = .failed(error)
            }
        } catch {
            outcome = .failed(.invalidResponse(status: 0))
        }
        await onChange?()
        return outcome
    }

    // MARK: - push

    private func push() async throws {
        let ops = try await database.pendingOps()
        let started = now()
        var blocked = Set<String>()
        var earliest: Int64?

        for listed in ops {
            if blocked.contains(listed.noteID) { continue }
            if listed.nextAttemptAt > started {
                // An op waiting for its retry holds back every later op for the same note, so order is kept.
                blocked.insert(listed.noteID)
                earliest = min(earliest ?? listed.nextAttemptAt, listed.nextAttemptAt)
                continue
            }
            guard let op = try await database.beginSend(listed.opID) else { continue }
            do {
                let answer = try await send(op)
                try await database.settle(op, serverNote: answer)
            } catch let error as APIError {
                if error == .signedOut {
                    try await database.release(op)
                    schedule(earliest)
                    throw error
                }
                if op.kind == .delete && error.isNotFound {
                    // already gone on the server
                    try await database.settle(op, serverNote: nil)
                    continue
                }
                if error.isRetryable {
                    let tries = op.tries + 1
                    let next = now() + Self.backoff(tries: tries)
                    try await database.retry(op, tries: tries, nextAttemptAt: next)
                    blocked.insert(op.noteID)
                    earliest = min(earliest ?? next, next)
                    if error.isOffline {
                        schedule(earliest)
                        throw error
                    }
                    continue
                }
                // Refused for good (a 4xx): drop the op and take the server's copy of the note.
                try await database.drop(op)
                await repair(noteID: op.noteID)
            }
        }
        schedule(earliest)
    }

    private func send(_ op: OutboxOp) async throws -> Note? {
        switch op.kind {
        case .create:
            return try await client.createNote(
                id: op.noteID, title: op.title ?? "", body: op.body ?? "", idempotencyKey: op.idempotencyKey)
        case .update:
            return try await client.updateNote(
                id: op.noteID, title: op.title, body: op.body, idempotencyKey: op.idempotencyKey)
        case .delete:
            try await client.deleteNote(id: op.noteID, idempotencyKey: op.idempotencyKey)
            return nil
        }
    }

    /// After a refusal: the server's copy of the note, or nothing when it has none.
    private func repair(noteID: String) async {
        do {
            let note = try await client.note(id: noteID)
            try await database.putServerNote(note)
        } catch let error as APIError where error.isNotFound {
            try? await database.removeServerNote(id: noteID)
        } catch {
            // the next pull settles it
        }
    }

    /// 2 s, 4 s, 8 s … up to 5 minutes.
    static func backoff(tries: Int) -> Int64 {
        let seconds = min(300, 1 << min(max(tries, 1), 9))
        return Int64(seconds) * 1000
    }

    private func schedule(_ at: Int64?) {
        wake?.cancel()
        wake = nil
        guard let at else { return }
        let delay = max(0, at - now())
        wake = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(delay))
            guard !Task.isCancelled, let self else { return }
            await self.syncNow()
        }
    }

    // MARK: - pull

    private func pull() async throws {
        var since = await database.cursor()
        var restarted = false
        var pages = 0
        while pages < Self.maxPages {
            let page: SyncPage
            do {
                page = try await client.pull(since: since)
            } catch let error as APIError where error.code == APIError.syncTooOld || error.status == 410 {
                // The cursor is older than the oldest kept delete marker: drop the copy and pull from 0, once.
                guard !restarted else { throw error }
                restarted = true
                try await database.resetForRepull()
                since = 0
                continue
            }
            try await database.apply(page)
            pages += 1
            await onChange?()
            if !page.more || page.next <= since { break }
            since = page.next
        }
    }
}
