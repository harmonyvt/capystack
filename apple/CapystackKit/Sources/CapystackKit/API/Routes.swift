import Foundation

/// The routes the app calls, by the names `api/scripts/gen.mjs` writes into `Endpoints.generated.swift` (op name
/// camelCased: `notes.list` → `notesList`). Only this file names generated endpoints, so a renamed op breaks the build
/// here and nowhere else.
enum Route {
    static var capabilities: Endpoint { .systemCapabilities }
    static var exchange: Endpoint { .authExchange }
    static var me: Endpoint { .authMe }
    static var sessions: Endpoint { .authSessions }
    static var revokeSession: Endpoint { .authRevoke }
    static var signOut: Endpoint { .authSignout }
    static var keys: Endpoint { .keysList }
    static var createKey: Endpoint { .keysCreate }
    static var revokeKey: Endpoint { .keysRevoke }
    static var notes: Endpoint { .notesList }
    static var note: Endpoint { .notesGet }
    static var createNote: Endpoint { .notesCreate }
    static var updateNote: Endpoint { .notesUpdate }
    static var deleteNote: Endpoint { .notesDelete }
    static var summarize: Endpoint { .notesSummarize }
    static var sync: Endpoint { .syncPull }
    static var createThread: Endpoint { .chatCreate }
    static var threads: Endpoint { .chatList }
    static var thread: Endpoint { .chatGet }
    static var sendChat: Endpoint { .chatSend }
    static var registerPush: Endpoint { .pushRegister }
    static var unregisterPush: Endpoint { .pushUnregister }
    static var demoJob: Endpoint { .jobsDemo }
    static var job: Endpoint { .jobsGet }
}
