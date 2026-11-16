import Foundation
import Security
import Synchronization

/// Generic-password items, in the app group's keychain access group when the build is entitled for it (so an extension
/// can read the token), else the process's default keychain. An unsigned DEBUG build, whose keychain refuses every call
/// (-34018), keeps the value in a small file in its own container instead; a release build never writes a secret to disk.
public struct Keychain: Sendable {
    private let service: String
    private let accessGroup: String?
    private let memory: MemoryValues?

    public init(service: String = AppConfig.keychainService, accessGroup: String? = AppConfig.appGroup) {
        self.service = service
        self.accessGroup = accessGroup
        self.memory = nil
    }

    private init(memory: MemoryValues) {
        self.service = "memory"
        self.accessGroup = nil
        self.memory = memory
    }

    /// Values in memory only: previews and tests never touch the real keychain.
    public static func inMemory() -> Keychain { Keychain(memory: MemoryValues()) }

    public func string(for account: String) -> String? {
        if let memory { return memory.get(account) }
        for query in queries(account) {
            var q = query
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            if SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
               let data = result as? Data, let value = String(data: data, encoding: .utf8) {
                return value
            }
        }
        return DebugSecretFile.get(service: service, account: account)
    }

    public func set(_ value: String?, for account: String) throws {
        if let memory { memory.set(value, for: account); return }
        guard let value else {
            for query in queries(account) { SecItemDelete(query as CFDictionary) }
            DebugSecretFile.set(nil, service: service, account: account)
            return
        }
        let data = Data(value.utf8)
        var lastStatus: OSStatus = errSecSuccess
        for query in queries(account) {
            let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if update == errSecSuccess { DebugSecretFile.set(nil, service: service, account: account); return }
            if update == errSecItemNotFound {
                var add = query
                add[kSecValueData as String] = data
                add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
                let status = SecItemAdd(add as CFDictionary, nil)
                if status == errSecSuccess { DebugSecretFile.set(nil, service: service, account: account); return }
                lastStatus = status
            } else {
                lastStatus = update
            }
            // A group this build is not entitled to: try the next (default) keychain.
            guard Self.isEntitlementFailure(lastStatus) else { throw KeychainError(status: lastStatus) }
        }
        if DebugSecretFile.set(value, service: service, account: account) { return }
        throw KeychainError(status: lastStatus)
    }

    /// Most specific first: the shared group, then the default keychain.
    private func queries(_ account: String) -> [[String: Any]] {
        var base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        #if os(macOS)
        // App groups work as access groups only in the data protection keychain on the Mac.
        base[kSecUseDataProtectionKeychain as String] = true
        #endif
        guard let accessGroup else { return [base] }
        var grouped = base
        grouped[kSecAttrAccessGroup as String] = accessGroup
        return [grouped, base]
    }

    static func isEntitlementFailure(_ status: OSStatus) -> Bool {
        status == errSecMissingEntitlement || status == errSecNoAccessForItem || status == errSecParam
            || status == errSecInteractionNotAllowed
    }
}

public struct KeychainError: Error, Sendable, Equatable {
    public var status: OSStatus
}

private final class MemoryValues: Sendable {
    private let values = Mutex<[String: String]>([:])
    func get(_ account: String) -> String? { values.withLock { $0[account] } }
    func set(_ value: String?, for account: String) { values.withLock { $0[account] = value } }
}

/// DEBUG builds only: unsigned simulator and Mac builds have no keychain at all. One file per account in Application
/// Support, excluded from backup. In release builds every call does nothing (and `set` answers false).
private enum DebugSecretFile {
    private static func url(service: String, account: String) -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let safe = String("\(service)--\(account)".map { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" ? $0 : "_" })
        return base.appendingPathComponent("\(AppConfig.bundleID)/unentitled-secrets", isDirectory: true)
            .appendingPathComponent(safe, isDirectory: false)
    }

    static func get(service: String, account: String) -> String? {
        #if DEBUG
        guard let file = url(service: service, account: account) else { return nil }
        return (try? Data(contentsOf: file)).flatMap { String(data: $0, encoding: .utf8) }
        #else
        return nil
        #endif
    }

    @discardableResult
    static func set(_ value: String?, service: String, account: String) -> Bool {
        #if DEBUG
        guard let file = url(service: service, account: account) else { return false }
        guard let value else {
            try? FileManager.default.removeItem(at: file)
            return true
        }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(value.utf8).write(to: file, options: [.atomic])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutable = file
            try? mutable.setResourceValues(values)
            return true
        } catch {
            return false
        }
        #else
        return false
        #endif
    }
}

/// This device's session token (docs/CONTRACT.md section 3).
public struct TokenStore: Sendable {
    static let account = "session-token"
    private let keychain: Keychain

    public init(keychain: Keychain) {
        self.keychain = keychain
    }

    /// The real keychain, shared through the app group when entitled.
    public static var live: TokenStore { TokenStore(keychain: Keychain()) }

    /// In memory (previews, tests), optionally holding a token already.
    public static func memory(token: String? = nil) -> TokenStore {
        let store = TokenStore(keychain: .inMemory())
        if let token { try? store.save(token) }
        return store
    }

    public var token: String? { keychain.string(for: Self.account) }
    public var hasToken: Bool { !(token ?? "").isEmpty }

    public func save(_ token: String) throws { try keychain.set(token, for: Self.account) }
    public func clear() { try? keychain.set(nil, for: Self.account) }
}
