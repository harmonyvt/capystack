import Foundation
import Observation

/// Settings › account: who this device is, the signed-in devices and the keys for tools.
@MainActor @Observable
public final class AccountModel {
    public enum Phase: Sendable, Equatable { case idle, loading, ready, failed }

    public private(set) var phase: Phase = .idle
    public private(set) var me: Session?
    /// Signed-in devices, this one first.
    public private(set) var sessions: [Session] = []
    public private(set) var keys: [ToolKey] = []

    @ObservationIgnored private let client: any CapystackClient

    init(client: any CapystackClient) {
        self.client = client
    }

    public var otherSessions: [Session] { sessions.filter { $0.id != me?.id } }

    public func isCurrent(_ session: Session) -> Bool { session.id == me?.id }

    /// `/auth/me`, `/auth/sessions` and `/auth/keys` together.
    public func refresh() async {
        if phase != .ready { phase = .loading }
        let client = self.client
        do {
            async let meAnswer = client.me()
            async let sessionsAnswer = client.sessions()
            async let keysAnswer = client.keys()
            let (m, s, k) = try await (meAnswer, sessionsAnswer, keysAnswer)
            me = m
            sessions = s.sorted { a, b in
                if a.id == m.id { return true }
                if b.id == m.id { return false }
                return (a.lastUsedAt ?? a.createdAt) > (b.lastUsedAt ?? b.createdAt)
            }
            keys = k
            phase = .ready
        } catch {
            if phase != .ready { phase = .failed }
        }
    }

    /// Signs another device out. Already gone counts as done.
    public func revoke(_ session: Session) async throws {
        do {
            try await client.revokeSession(id: session.id)
        } catch let error as APIError where error.isNotFound {
            // already signed out somewhere else
        }
        sessions.removeAll { $0.id == session.id }
    }

    /// A new key for tools. The answer holds the token, shown once; nothing here keeps it.
    public func createKey(name: String) async throws -> CreatedKey {
        let made = try await client.createKey(name: name.trimmingCharacters(in: .whitespacesAndNewlines))
        keys.removeAll { $0.id == made.key.id }
        keys.insert(made.key, at: 0)
        return made
    }

    /// The row leaves at once and comes back if the server says no.
    public func revoke(_ key: ToolKey) async throws {
        let before = keys
        keys.removeAll { $0.id == key.id }
        do {
            try await client.revokeKey(id: key.id)
        } catch let error as APIError where error.isNotFound {
            // already gone
        } catch {
            keys = before
            throw error
        }
    }

    func reset() {
        phase = .idle
        me = nil
        sessions = []
        keys = []
    }
}
