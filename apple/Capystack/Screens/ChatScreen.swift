import CapystackKit
import SwiftUI

/// Chat threads with the model about the notes (online only).
struct ChatScreen: View {
    let model: AppModel
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            ChatList(model: model, newChat: newChat)
                .navigationTitle(Copy.Chat.title)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        IconButton(Copy.Chat.new, systemImage: Symbol.add, prominent: true) { newChat() }
                            .disabled(!chatOn)
                    }
                }
                .navigationDestination(for: String.self) { id in
                    ChatThreadScreen(model: model, threadID: id)
                }
        }
        .onAppear { Analytics.screen("chat") }
    }

    private var chatOn: Bool { model.capabilities.features.ai }

    private func newChat() {
        Task {
            do {
                let thread = try await model.chat.newThread()
                path.append(thread.id)
            } catch {
                model.show(Copy.message(for: error) ?? Copy.Chat.failed, kind: .error)
            }
        }
    }
}

private struct ChatList: View {
    let model: AppModel
    let newChat: () -> Void

    var body: some View {
        content
            .task { await model.chat.refresh() }
            .refreshable { await model.chat.refresh() }
    }

    /// The server answered and has no model key.
    private var chatOff: Bool { model.capabilities != .unknown && !model.capabilities.features.ai }

    @ViewBuilder private var content: some View {
        let chat = model.chat
        if chatOff {
            EmptyState(systemImage: Symbol.sparkles, title: Copy.Chat.offTitle, message: Copy.Chat.offLine)
        } else if chat.phase == .loading || chat.phase == .idle {
            SkeletonList(rows: 4)
        } else if chat.threads.isEmpty {
            EmptyState(
                systemImage: Symbol.chat, title: Copy.Chat.emptyTitle, message: Copy.Chat.emptyLine,
                actionTitle: Copy.Chat.new, action: newChat)
        } else {
            List(chat.threads) { thread in
                NavigationLink(value: thread.id) {
                    ListRow(
                        thread.title.isEmpty ? Copy.Chat.untitled : thread.title,
                        subtitle: Copy.relative(thread.updatedDate))
                        .privacyMask()
                }
            }
            .scrollContentBackground(.hidden)
            .background(Tokens.Color.bg)
        }
    }
}
