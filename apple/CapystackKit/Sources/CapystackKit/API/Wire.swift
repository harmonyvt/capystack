import Foundation

/// JSON in and out. Every model spells its snake_case keys in its own `CodingKeys`, so the coders stay plain.
enum Wire {
    static func decoder() -> JSONDecoder { JSONDecoder() }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    /// Decodes `{ "<key>": T }`, or a bare `T` when the answer has no such key. The API wraps most answers
    /// (`{note}`, `{job}`, `{thread}`), and reading both keeps the client working if a route answers bare.
    static func decode<T: Decodable>(_ type: T.Type, from data: Data, key: String?) throws -> T {
        if let key,
           let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
           let dict = object as? [String: Any],
           let inner = dict[key], !(inner is NSNull) {
            let innerData = try JSONSerialization.data(withJSONObject: inner, options: [.fragmentsAllowed])
            return try decoder().decode(T.self, from: innerData)
        }
        return try decoder().decode(T.self, from: data)
    }

    static func body(_ object: [String: String]) -> Data? {
        try? encoder().encode(object)
    }
}

/// A coding key made from any string, for lenient decoders that look at several possible keys.
struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }

    init(_ string: String) { stringValue = string }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

/// Small helpers for fields the server may send as an integer, a float or null.
enum Lenient {
    /// Milliseconds since 1970 sent as an integer (or, defensively, a float).
    static func millis(_ c: KeyedDecodingContainer<AnyKey>, _ key: String) -> Int64? {
        if let v = try? c.decode(Int64.self, forKey: AnyKey(key)) { return v }
        if let v = try? c.decode(Double.self, forKey: AnyKey(key)) { return Int64(v) }
        return nil
    }

    static func string(_ c: KeyedDecodingContainer<AnyKey>, _ key: String) -> String? {
        try? c.decode(String.self, forKey: AnyKey(key))
    }

    /// A string or a number, as text (pagination cursors).
    static func text(_ c: KeyedDecodingContainer<AnyKey>, _ key: String) -> String? {
        if let s = try? c.decode(String.self, forKey: AnyKey(key)) { return s }
        if let n = try? c.decode(Int64.self, forKey: AnyKey(key)) { return String(n) }
        if let d = try? c.decode(Double.self, forKey: AnyKey(key)) { return String(Int64(d)) }
        return nil
    }
}

/// Milliseconds since 1970 for "now" and back.
public enum Millis {
    public static func now() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }
    public static func date(_ ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }
}
