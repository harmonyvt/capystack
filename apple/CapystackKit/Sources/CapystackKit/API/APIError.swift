import Foundation

/// What a request can fail with. The server's errors are `{ error: "<dotted.code>", message? }` with the usual HTTP
/// status (docs/CONTRACT.md section 4); `401` (`auth.required`) is `.signedOut` everywhere.
public enum APIError: Error, Sendable, Equatable {
    /// No token on this device, or the server refused it (401 `auth.required`): the app shows "sign in again".
    case signedOut
    /// The server answered with an error code.
    case server(code: String, status: Int, message: String?)
    /// Nothing reached the server (`URLError.Code` raw value).
    case network(code: Int)
    /// An answer the client could not read.
    case invalidResponse(status: Int)

    public static let authRequired = "auth.required"
    public static let syncTooOld = "sync.too_old"
    public static let aiOff = "ai.off"
    public static let notFound = "not_found"

    /// The dotted code, when the server sent one (`auth.required` for `.signedOut`).
    public var code: String? {
        switch self {
        case .signedOut: return APIError.authRequired
        case .server(let code, _, _): return code
        case .network, .invalidResponse: return nil
        }
    }

    public var status: Int? {
        switch self {
        case .signedOut: return 401
        case .server(_, let status, _): return status
        case .invalidResponse(let status): return status
        case .network: return nil
        }
    }

    public var message: String? {
        if case .server(_, _, let message) = self { return message }
        return nil
    }

    public var isOffline: Bool {
        if case .network = self { return true }
        return false
    }

    public var isNotFound: Bool { status == 404 }

    /// Worth trying again later with the same request: offline, timeouts, rate limits, server trouble.
    public var isRetryable: Bool {
        switch self {
        case .network: return true
        case .signedOut: return false
        case .server(_, let status, _), .invalidResponse(let status):
            return status == 408 || status == 425 || status == 429 || status >= 500 || status == 0
        }
    }

    /// The error for a non-2xx answer.
    static func from(status: Int, data: Data) -> APIError {
        let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
        let code = envelope?.error
        if status == 401 || code == authRequired { return .signedOut }
        if let code, !code.isEmpty { return .server(code: code, status: status, message: envelope?.message) }
        return .server(code: status == 404 ? notFound : "http.\(status)", status: status, message: nil)
    }
}

/// `{ error: "<dotted.code>", message? }`. `error` is read leniently: an object with a `code` works too.
struct ErrorEnvelope: Decodable {
    var error: String?
    var message: String?

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        if let s = try? c.decode(String.self, forKey: AnyKey("error")) {
            error = s
        } else if let inner = try? c.nestedContainer(keyedBy: AnyKey.self, forKey: AnyKey("error")) {
            error = try? inner.decode(String.self, forKey: AnyKey("code"))
        } else {
            error = nil
        }
        message = try? c.decode(String.self, forKey: AnyKey("message"))
    }
}
