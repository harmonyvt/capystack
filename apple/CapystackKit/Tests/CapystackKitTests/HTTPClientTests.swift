import Foundation
import Synchronization
import Testing
@testable import CapystackKit

/// Answers every request from `StubProtocol.handler` and remembers the requests.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    struct Reply: Sendable {
        var status: Int
        var body: String
    }

    static let handler = Mutex<(@Sendable (URLRequest) -> Reply)?>(nil)
    static let seen = Mutex<[URLRequest]>([])

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = self.request
        Self.seen.withLock { $0.append(request) }
        let reply = Self.handler.withLock { $0 }?(request) ?? Reply(status: 500, body: "")
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func session(_ handler: @escaping @Sendable (URLRequest) -> Reply) -> URLSession {
        self.handler.withLock { $0 = handler }
        seen.withLock { $0 = [] }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: config)
    }
}

final class Flag: Sendable {
    private let value = Mutex(false)
    func set() { value.withLock { $0 = true } }
    var isSet: Bool { value.withLock { $0 } }
}

@Suite(.serialized) struct HTTPClientTests {
    @Test func sendsBearerAndIdempotencyKey() async throws {
        let session = StubProtocol.session { _ in .init(status: 200, body: #"{"note":{"id":"a","title":"t","body":"b","created_at":1,"updated_at":2}}"#) }
        let client = HTTPClient(baseURL: URL(string: "https://api.example.com")!, session: session, token: { "tok" })
        let note = try await client.createNote(id: "a", title: "t", body: "b", idempotencyKey: "key-1")
        let request = try #require(StubProtocol.seen.withLock { $0.first })
        #expect(note?.id == "a")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "key-1")
        #expect(request.httpMethod == "POST")
        #expect(request.url?.absoluteString == "https://api.example.com/notes")
    }

    @Test func fillsPathsAndQueries() async throws {
        let session = StubProtocol.session { _ in .init(status: 200, body: #"{"since":5,"next":5,"more":false,"notes":[],"gone":[]}"#) }
        let client = HTTPClient(baseURL: URL(string: "https://api.example.com")!, session: session, token: { "tok" })
        _ = try await client.pull(since: 5)
        try await client.revokeKey(id: "k 1")
        let urls = StubProtocol.seen.withLock { $0.map { $0.url?.absoluteString ?? "" } }
        #expect(urls == ["https://api.example.com/sync?since=5", "https://api.example.com/auth/keys/k%201"])
    }

    @Test func unauthorizedSignsOut() async throws {
        let flag = Flag()
        let session = StubProtocol.session { _ in .init(status: 401, body: #"{"error":"auth.required"}"#) }
        let client = HTTPClient(
            baseURL: URL(string: "https://api.example.com")!, session: session, token: { "tok" }, onSignedOut: { flag.set() })
        await #expect(throws: APIError.signedOut) {
            _ = try await client.me()
        }
        #expect(flag.isSet)
    }

    @Test func noTokenNeverCallsTheServer() async throws {
        let session = StubProtocol.session { _ in .init(status: 200, body: "{}") }
        let client = HTTPClient(baseURL: URL(string: "https://api.example.com")!, session: session, token: { nil })
        await #expect(throws: APIError.signedOut) {
            _ = try await client.keys()
        }
        let count = StubProtocol.seen.withLock { $0.count }
        #expect(count == 0)
    }

    @Test func capabilitiesAreOpen() async throws {
        let session = StubProtocol.session { _ in .init(status: 200, body: #"{"name":"capystack","version":"1","features":{"ai":true}}"#) }
        let client = HTTPClient(baseURL: URL(string: "https://api.example.com")!, session: session, token: { nil })
        let caps = try await client.capabilities()
        let request = try #require(StubProtocol.seen.withLock { $0.first })
        #expect(caps.features.ai)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func tooOldIsAServerError() async throws {
        let session = StubProtocol.session { _ in .init(status: 410, body: #"{"error":"sync.too_old"}"#) }
        let client = HTTPClient(baseURL: URL(string: "https://api.example.com")!, session: session, token: { "tok" })
        await #expect(throws: APIError.server(code: "sync.too_old", status: 410, message: nil)) {
            _ = try await client.pull(since: 1)
        }
    }
}
