import Foundation

/// The real client (docs/CONTRACT.md sections 3-5). Rules:
/// - `Authorization: Bearer <token>` on every keyed route, and only to `baseURL`'s host; a keyed call with no token
///   throws `.signedOut` before any request.
/// - `Accept: application/json` everywhere; JSON bodies; `Idempotency-Key` on note writes.
/// - Any 401 on a keyed route throws `.signedOut` and calls `onSignedOut` (the app goes to the signed-out state).
public struct HTTPClient: CapystackClient {
    public let baseURL: URL
    let session: URLSession
    let token: @Sendable () -> String?
    let onSignedOut: @Sendable () -> Void

    public init(
        baseURL: URL = AppConfig.apiBase, session: URLSession = .shared,
        token: @escaping @Sendable () -> String?, onSignedOut: @escaping @Sendable () -> Void = {}
    ) {
        self.baseURL = baseURL
        self.session = session
        self.token = token
        self.onSignedOut = onSignedOut
    }

    // MARK: - plumbing

    func makeRequest(
        _ endpoint: Endpoint, params: [String: String] = [:], query: [URLQueryItem] = [],
        body: Data? = nil, idempotencyKey: String? = nil, keyed: Bool = true, timeout: TimeInterval = 30
    ) throws -> URLRequest {
        guard var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidResponse(status: 0)
        }
        let basePath = comps.path.hasSuffix("/") ? String(comps.path.dropLast()) : comps.path
        comps.percentEncodedPath = basePath + endpoint.path(params)
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { throw APIError.invalidResponse(status: 0) }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if keyed {
            guard let token = token(), !token.isEmpty else { throw APIError.signedOut }
            if url.host?.lowercased() == baseURL.host?.lowercased() {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        }
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    /// Sends the request; answers the body of a 2xx, throws `APIError` for anything else.
    func send(
        _ endpoint: Endpoint, params: [String: String] = [:], query: [URLQueryItem] = [],
        body: Data? = nil, idempotencyKey: String? = nil, keyed: Bool = true, timeout: TimeInterval = 30
    ) async throws -> Data {
        let request = try makeRequest(
            endpoint, params: params, query: query, body: body, idempotencyKey: idempotencyKey, keyed: keyed, timeout: timeout)
        let result: (Data, URLResponse)
        do {
            result = try await session.data(for: request)
        } catch let error as URLError {
            throw APIError.network(code: error.code.rawValue)
        }
        let (data, response) = result
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse(status: 0) }
        guard (200..<300).contains(http.statusCode) else {
            let error = APIError.from(status: http.statusCode, data: data)
            if keyed, error == .signedOut { onSignedOut() }
            throw error
        }
        return data
    }

    func decode<T: Decodable>(_ type: T.Type, _ data: Data, key: String? = nil) throws -> T {
        do {
            return try Wire.decode(type, from: data, key: key)
        } catch {
            throw APIError.invalidResponse(status: 200)
        }
    }

    // MARK: - system

    public func capabilities() async throws -> Capabilities {
        let data = try await send(Route.capabilities, keyed: false, timeout: 15)
        return try decode(Capabilities.self, data)
    }

    // MARK: - auth

    public func exchange(code: String, verifier: String, device: String, platform: String) async throws -> SignInResult {
        let body = Wire.body(["code": code, "verifier": verifier, "device": device, "platform": platform])
        let data = try await send(Route.exchange, body: body, keyed: false)
        return try decode(SignInResult.self, data)
    }

    public func me() async throws -> Session {
        let data = try await send(Route.me)
        return try decode(Session.self, data, key: "session")
    }

    public func sessions() async throws -> [Session] {
        let data = try await send(Route.sessions)
        return try decode([Session].self, data, key: "sessions")
    }

    public func revokeSession(id: String) async throws {
        _ = try await send(Route.revokeSession, params: ["id": id])
    }

    public func signOut() async throws {
        _ = try await send(Route.signOut, body: Data("{}".utf8))
    }

    public func keys() async throws -> [ToolKey] {
        let data = try await send(Route.keys)
        return try decode([ToolKey].self, data, key: "keys")
    }

    public func createKey(name: String) async throws -> CreatedKey {
        let data = try await send(Route.createKey, body: Wire.body(["name": name]))
        return try decode(CreatedKey.self, data)
    }

    public func revokeKey(id: String) async throws {
        _ = try await send(Route.revokeKey, params: ["id": id])
    }

    // MARK: - notes

    public func listNotes(limit: Int, before: String?) async throws -> NotesPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        let data = try await send(Route.notes, query: query)
        return try decode(NotesPage.self, data)
    }

    public func note(id: String) async throws -> Note {
        let data = try await send(Route.note, params: ["id": id])
        return try decode(Note.self, data, key: "note")
    }

    public func createNote(id: String, title: String, body: String, idempotencyKey: String) async throws -> Note? {
        let payload = Wire.body(["id": id, "title": title, "body": body])
        let data = try await send(Route.createNote, body: payload, idempotencyKey: idempotencyKey)
        return try? Wire.decode(Note.self, from: data, key: "note")
    }

    public func updateNote(id: String, title: String?, body: String?, idempotencyKey: String) async throws -> Note? {
        var fields: [String: String] = [:]
        if let title { fields["title"] = title }
        if let body { fields["body"] = body }
        let data = try await send(Route.updateNote, params: ["id": id], body: Wire.body(fields), idempotencyKey: idempotencyKey)
        return try? Wire.decode(Note.self, from: data, key: "note")
    }

    public func deleteNote(id: String, idempotencyKey: String) async throws {
        _ = try await send(Route.deleteNote, params: ["id": id], idempotencyKey: idempotencyKey)
    }

    public func summarize(noteID: String) async throws -> String {
        let data = try await send(Route.summarize, params: ["id": noteID], body: Data("{}".utf8), timeout: 60)
        return try decode(String.self, data, key: "summary")
    }

    // MARK: - sync

    public func pull(since: Int64) async throws -> SyncPage {
        let data = try await send(Route.sync, query: [URLQueryItem(name: "since", value: String(since))])
        return try decode(SyncPage.self, data)
    }

    // MARK: - chat

    public func chatThreads() async throws -> [ChatThread] {
        let data = try await send(Route.threads)
        return try decode([ChatThread].self, data, key: "threads")
    }

    public func createChatThread(title: String?) async throws -> ChatThread {
        var fields: [String: String] = [:]
        if let title { fields["title"] = title }
        let data = try await send(Route.createThread, body: Wire.body(fields))
        return try decode(ChatThread.self, data, key: "thread")
    }

    public func chatThread(id: String) async throws -> ChatThreadDetail {
        let data = try await send(Route.thread, params: ["id": id])
        return try decode(ChatThreadDetail.self, data)
    }

    /// The model runs a tool loop (up to 8 turns), so this waits longer than other calls.
    public func sendChat(threadID: String, text: String) async throws -> [ChatMessage] {
        let data = try await send(Route.sendChat, params: ["id": threadID], body: Wire.body(["text": text]), timeout: 120)
        return (try? Wire.decode([ChatMessage].self, from: data, key: "messages")) ?? []
    }

    // MARK: - push and jobs

    public func registerPush(_ registration: PushRegistration) async throws {
        _ = try await send(Route.registerPush, body: Wire.body(registration.body))
    }

    public func unregisterPush(id: String) async throws {
        _ = try await send(Route.unregisterPush, params: ["id": id])
    }

    public func startDemoJob(seconds: Int?) async throws -> Job {
        var body = Data("{}".utf8)
        if let seconds { body = (try? Wire.encoder().encode(["seconds": seconds])) ?? body }
        let data = try await send(Route.demoJob, body: body)
        return try decode(Job.self, data, key: "job")
    }

    public func job(id: String) async throws -> Job {
        let data = try await send(Route.job, params: ["id": id])
        return try decode(Job.self, data, key: "job")
    }
}
