import CapystackKit
import SwiftUI

/// One note. Edits save to the device as you type (after a short pause) and on leaving; the outbox sends them.
struct NoteEditorScreen: View {
    let model: AppModel
    let noteID: String

    @State private var title = ""
    @State private var text = ""
    @State private var loaded = false
    @State private var confirmingDelete = false
    @State private var summary: String?
    @State private var showingSummary = false
    @State private var deleted = false
    @Environment(\.dismiss) private var dismiss

    /// What the debounce waits on.
    private struct Draft: Equatable {
        var title: String
        var text: String
    }

    var body: some View {
        content
            .toolbar { toolbar }
            .modifier(InlineTitle())
            .task(id: Draft(title: title, text: text)) { await saveAfterPause() }
            .onAppear { load() }
            .onDisappear { saveNow() }
            .modifier(EditorDialogs(
                confirmingDelete: $confirmingDelete, showingSummary: $showingSummary, summary: summary, onDelete: delete))
    }

    @ViewBuilder private var content: some View {
        if loaded && model.notes.note(id: noteID) == nil && !deleted {
            EmptyState(systemImage: Symbol.empty, title: Copy.Notes.missing, message: "")
        } else {
            editor
        }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            TextField(Copy.Notes.titlePlaceholder, text: $title)
                .font(Tokens.Font.title)
                .foregroundStyle(Tokens.Color.text)
                .textFieldStyle(.plain)
            TextEditor(text: $text)
                .font(Tokens.Font.body)
                .foregroundStyle(Tokens.Color.text)
                .scrollContentBackground(.hidden)
                .overlay(alignment: .topLeading) { bodyPlaceholder }
        }
        .padding(Tokens.Space.s5)
        .privacyMask()
        .background(Tokens.Color.bg)
    }

    @ViewBuilder private var bodyPlaceholder: some View {
        if text.isEmpty {
            Text(Copy.Notes.bodyPlaceholder)
                .font(Tokens.Font.body)
                .foregroundStyle(Tokens.Color.textMuted)
                .padding(.top, Tokens.Space.s2)
                .padding(.leading, Tokens.Space.s1)
                .allowsHitTesting(false)
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if model.capabilities.features.ai {
            ToolbarItem(placement: .primaryAction) {
                IconButton(Copy.Notes.summarize, systemImage: Symbol.summarize) { summarize() }
            }
        }
        ToolbarItem(placement: .primaryAction) {
            IconButton(Copy.Notes.delete, systemImage: Symbol.delete, role: .destructive) { confirmingDelete = true }
        }
    }

    // MARK: - actions

    private func load() {
        guard !loaded else { return }
        if let note = model.notes.note(id: noteID) {
            title = note.title
            text = note.body
        }
        loaded = true
        Analytics.screen("note")
    }

    private func saveAfterPause() async {
        guard loaded else { return }
        try? await Task.sleep(for: .milliseconds(600))
        guard !Task.isCancelled else { return }
        await model.notes.update(id: noteID, title: title, body: text)
    }

    private func saveNow() {
        guard loaded, !deleted else { return }
        let id = noteID, title = title, text = text
        Task { await model.notes.update(id: id, title: title, body: text) }
    }

    private func delete() {
        deleted = true
        Task {
            await model.notes.delete(id: noteID)
            dismiss()
        }
    }

    private func summarize() {
        Task {
            // flush the latest text so the server reads it
            await model.notes.update(id: noteID, title: title, body: text)
            await model.notes.sync()
            do {
                summary = try await model.notes.summarize(id: noteID)
                showingSummary = true
            } catch {
                model.show(Copy.message(for: error) ?? Copy.Common.retry, kind: .error)
            }
        }
    }
}

/// The delete confirmation and the summary sheet.
private struct EditorDialogs: ViewModifier {
    @Binding var confirmingDelete: Bool
    @Binding var showingSummary: Bool
    let summary: String?
    let onDelete: () -> Void

    func body(content: Content) -> some View {
        content
            .confirmationDialog(Copy.Notes.deleteConfirm, isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button(Copy.Notes.delete, role: .destructive, action: onDelete)
                Button(Copy.Common.cancel, role: .cancel) {}
            } message: {
                Text(Copy.Notes.deleteLine)
            }
            .sheet(isPresented: $showingSummary) {
                Sheet(title: Copy.Notes.summaryTitle) {
                    Text(summary ?? "")
                        .font(Tokens.Font.body)
                        .foregroundStyle(Tokens.Color.text)
                        .textSelection(.enabled)
                        .privacyMask()
                }
            }
    }
}

/// A small title bar on iPhone and iPad.
private struct InlineTitle: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        content.navigationBarTitleDisplayMode(.inline)
        #else
        content
        #endif
    }
}
