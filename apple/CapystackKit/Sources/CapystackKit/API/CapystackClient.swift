import Foundation

/// Everything the app asks the API. `HTTPClient` is the real one; `PreviewClient` answers from memory with no network
/// (previews, tests, `AppModel.preview`).
public protocol CapystackClient: Sendable {
    // system
    func capabilities() async throws -> Capabilities

    // auth (section 3)
    func exchange(code: String, verifier: String, device: String, platform: String) async throws -> SignInResult
    func me() async throws -> Session
    func sessions() async throws -> [Session]
    func revokeSession(id: String) async throws
    func signOut() async throws
    func keys() async throws -> [ToolKey]
    func createKey(name: String) async throws -> CreatedKey
    func revokeKey(id: String) async throws

    // notes (writes carry an Idempotency-Key; the answer's note is nil when the server sent none we could read)
    func listNotes(limit: Int, before: String?) async throws -> NotesPage
    func note(id: String) async throws -> Note
    func createNote(id: String, title: String, body: String, idempotencyKey: String) async throws -> Note?
    func updateNote(id: String, title: String?, body: String?, idempotencyKey: String) async throws -> Note?
    func deleteNote(id: String, idempotencyKey: String) async throws
    func summarize(noteID: String) async throws -> String

    // sync (section 5)
    func pull(since: Int64) async throws -> SyncPage

    // chat
    func chatThreads() async throws -> [ChatThread]
    func createChatThread(title: String?) async throws -> ChatThread
    func chatThread(id: String) async throws -> ChatThreadDetail
    func sendChat(threadID: String, text: String) async throws -> [ChatMessage]

    // push and jobs (section 8)
    func registerPush(_ registration: PushRegistration) async throws
    func unregisterPush(id: String) async throws
    func startDemoJob(seconds: Int?) async throws -> Job
    func job(id: String) async throws -> Job
}

/// `POST /push/tokens`.
public struct PushRegistration: Sendable, Hashable {
    public enum Kind: String, Sendable {
        case device
        case liveStart = "live_start"
        case liveUpdate = "live_update"
    }

    public var kind: Kind
    /// Lowercase hex.
    public var token: String
    /// `ios`, `ipados` or `mac`.
    public var platform: String
    public var environment: PushEnvironment
    /// For `live_update`: the job id the activity shows (the server finds an activity's tokens by it).
    public var activityID: String?

    public init(kind: Kind, token: String, platform: String, environment: PushEnvironment, activityID: String? = nil) {
        self.kind = kind
        self.token = token
        self.platform = platform
        self.environment = environment
        self.activityID = activityID
    }

    var body: [String: String] {
        var body = ["kind": kind.rawValue, "token": token, "platform": platform, "env": environment.rawValue]
        if let activityID { body["activity_id"] = activityID }
        return body
    }
}

extension Data {
    /// APNs tokens are sent as lowercase hex.
    public var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
