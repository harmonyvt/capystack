import Foundation

/// One API route. The routes themselves are generated from the op registry into `Endpoints.generated.swift`
/// (`extension Endpoint { public static let notesList = Endpoint(method: "GET", path: "/notes") … }`, op names
/// camelCased, path parameters as `:id`). This file is the type and the helper that fills the parameters.
public struct Endpoint: Sendable, Hashable, CustomStringConvertible {
    public let method: String
    public let path: String

    public init(method: String, path: String) {
        self.method = method
        self.path = path
    }

    /// The path with every `:name` segment replaced by its percent-encoded value. A segment with no value is left as is.
    public func path(_ params: [String: String]) -> String {
        path.split(separator: "/", omittingEmptySubsequences: false)
            .map { segment -> String in
                guard segment.hasPrefix(":") else { return String(segment) }
                let name = String(segment.dropFirst())
                guard let value = params[name] else { return String(segment) }
                return Endpoint.encodeSegment(value)
            }
            .joined(separator: "/")
    }

    /// The path with `:id` filled.
    public func path(id: String) -> String { path(["id": id]) }

    /// Whether the path still has an unfilled `:name` segment.
    public static func hasParameters(_ path: String) -> Bool {
        path.split(separator: "/").contains { $0.hasPrefix(":") }
    }

    static func encodeSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#;")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    public var description: String { "\(method) \(path)" }
}
