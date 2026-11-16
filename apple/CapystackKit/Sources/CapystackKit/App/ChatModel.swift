import Foundation
import Observation

/// Chat threads with the model (online only; the server runs the tool loop).
@MainActor @Observable
public final class ChatModel {
    public enum Phase: Sendable, Equatable { case idle, loading, ready, failed }

    public private(set) var threads: [ChatThread] = []
    public private(set) var messages: [String: [ChatMessage]] = [:]
    public private(set) var phase: Phase = .idle
    /// Threads waiting for the model's answer.
    public private(set) var waiting: Set<String> = []

    @ObservationIgnored private let client: any CapystackClient

    init(client: any CapystackClient) {
        self.client = client
    }

    public func refresh() async {
        if phase != .ready { phase = .loading }
        do {
            threads = try await client.chatThreads()
            phase = .ready
        } catch {
            if phase != .ready { phase = .failed }
        }
    }

    public func open(_ threadID: String) async {
        guard let detail = try? await client.chatThread(id: threadID) else { return }
        messages[threadID] = detail.messages
        replace(detail.thread)
    }

    public func visibleMessages(_ threadID: String) -> [ChatMessage] {
        (messages[threadID] ?? []).filter(\.isVisible)
    }

    public func newThread() async throws -> ChatThread {
        let thread = try await client.createChatThread(title: nil)
        threads.insert(thread, at: 0)
        messages[thread.id] = []
        return thread
    }

    /// Shows the message at once, waits for the model, then reads the thread back (the server stores both sides).
    public func send(_ text: String, in threadID: String) async throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !waiting.contains(threadID) else { return }
        let local = ChatMessage(
            id: "local-\(UUID().uuidString.lowercased())", threadID: threadID, role: "user", text: trimmed, createdAt: Millis.now())
        messages[threadID, default: []].append(local)
        waiting.insert(threadID)
        defer { waiting.remove(threadID) }
        do {
            let answer = try await client.sendChat(threadID: threadID, text: trimmed)
            if let detail = try? await client.chatThread(id: threadID) {
                messages[threadID] = detail.messages
                replace(detail.thread)
            } else {
                var list = (messages[threadID] ?? []).filter { $0.id != local.id }
                list.append(contentsOf: answer)
                messages[threadID] = list
            }
        } catch {
            messages[threadID]?.removeAll { $0.id == local.id }
            throw error
        }
    }

    func reset() {
        threads = []
        messages = [:]
        phase = .idle
        waiting = []
    }

    private func replace(_ thread: ChatThread) {
        if let at = threads.firstIndex(where: { $0.id == thread.id }) {
            threads[at] = thread
        } else {
            threads.insert(thread, at: 0)
        }
    }
}
