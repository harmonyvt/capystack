import CapystackKit
import SwiftUI

/// One thread: the messages, newest at the bottom, and the box to write in.
struct ChatThreadScreen: View {
    let model: AppModel
    let threadID: String
    @State private var draft = ""

    var body: some View {
        messages
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(title)
            .task { await model.chat.open(threadID) }
            .haptic(.impact(weight: .light), trigger: model.chat.visibleMessages(threadID).count)
    }

    private var title: String {
        let thread = model.chat.threads.first { $0.id == threadID }
        let text = thread?.title ?? ""
        return text.isEmpty ? Copy.Chat.untitled : text
    }

    private var waiting: Bool { model.chat.waiting.contains(threadID) }

    private var messages: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Tokens.Space.s3) {
                let shown = model.chat.visibleMessages(threadID)
                if shown.isEmpty && !waiting {
                    Text(Copy.Chat.threadEmpty)
                        .font(Tokens.Font.body)
                        .foregroundStyle(Tokens.Color.textMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, Tokens.Space.s7)
                }
                ForEach(shown) { message in
                    MessageBubble(message: message)
                }
                if waiting {
                    ThinkingBubble()
                }
            }
            .padding(Tokens.Space.s4)
        }
        .defaultScrollAnchor(.bottom)
        .background(Tokens.Color.bg)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: Tokens.Space.s2) {
            InputField(placeholder: Copy.Chat.placeholder, text: $draft, multiline: true, onSubmit: send)
                .privacyMask()
            IconButton(Copy.Chat.send, systemImage: Symbol.send, prominent: true) { send() }
                .disabled(waiting || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, Tokens.Space.s2)
        .background(Tokens.Color.bg)
    }

    private func send() {
        let text = draft
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !waiting else { return }
        draft = ""
        Task {
            do {
                try await model.chat.send(text, in: threadID)
            } catch {
                draft = text
                model.show(Copy.message(for: error) ?? Copy.Chat.failed, kind: .error)
            }
        }
    }
}

private struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.isUser { Spacer(minLength: Tokens.Space.s7) }
            Text(message.text)
                .font(Tokens.Font.body)
                .foregroundStyle(message.isUser ? Tokens.Color.accentText : Tokens.Color.text)
                .textSelection(.enabled)
                .padding(.horizontal, Tokens.Space.s4)
                .padding(.vertical, Tokens.Space.s3)
                .background(bubble)
                .privacyMask()
            if !message.isUser { Spacer(minLength: Tokens.Space.s7) }
        }
    }

    private var bubble: some View {
        RoundedRectangle(cornerRadius: Tokens.Radius.lg, style: .continuous)
            .fill(message.isUser ? Tokens.Color.accent : Tokens.Color.surfaceRaised)
    }
}

/// The model is working: a skeleton line in a bubble (no spinner).
private struct ThinkingBubble: View {
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                Text(Copy.Chat.thinking)
                    .font(Tokens.Font.caption)
                    .foregroundStyle(Tokens.Color.textMuted)
                Skeleton(width: 160, height: 12)
            }
            .padding(Tokens.Space.s4)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.lg, style: .continuous).fill(Tokens.Color.surfaceRaised))
            Spacer(minLength: Tokens.Space.s7)
        }
    }
}
