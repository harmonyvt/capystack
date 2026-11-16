import CapystackKit
import SwiftUI

/// The notes list, from the on-device copy. New notes open in the editor at once.
struct NotesScreen: View {
    let model: AppModel
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            NotesList(model: model)
                .navigationTitle(Copy.Notes.title)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        IconButton(Copy.Notes.new, systemImage: Symbol.add, prominent: true) { newNote() }
                    }
                }
                .navigationDestination(for: String.self) { id in
                    NoteEditorScreen(model: model, noteID: id)
                }
        }
        .onAppear { Analytics.screen("notes") }
    }

    private func newNote() {
        Task {
            guard let note = await model.notes.create() else { return }
            path.append(note.id)
        }
    }
}

private struct NotesList: View {
    let model: AppModel

    var body: some View {
        content
            .safeAreaInset(edge: .bottom) { SyncStatusLine(notes: model.notes) }
            .refreshable { await model.notes.sync() }
            .haptic(.success, trigger: model.notes.pending, when: { $0 == 0 })
    }

    @ViewBuilder private var content: some View {
        let notes = model.notes
        if notes.phase == .loading {
            SkeletonList()
        } else if notes.notes.isEmpty {
            EmptyState(
                systemImage: Symbol.notes, title: Copy.Notes.emptyTitle, message: Copy.Notes.emptyLine,
                actionTitle: Copy.Notes.new
            ) {
                Task { await notes.create() }
            }
        } else {
            List(notes.notes) { note in
                NavigationLink(value: note.id) {
                    NoteRow(note: note)
                }
                .swipeActions {
                    Button(role: .destructive) {
                        Task { await notes.delete(id: note.id) }
                    } label: {
                        Label(Copy.Notes.delete, systemImage: Symbol.delete)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Tokens.Color.bg)
        }
    }
}

private struct NoteRow: View {
    let note: Note

    var body: some View {
        ListRow(title, subtitle: subtitle)
            .privacyMask()
    }

    private var title: String {
        let shown = note.displayTitle
        return shown.isEmpty ? Copy.Notes.untitled : shown
    }

    private var subtitle: String {
        let preview = note.body.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        let when = Copy.relative(note.updatedDate)
        return preview.isEmpty ? when : "\(when) · \(preview)"
    }
}

/// "3 changes waiting to sync" / "offline" under the list; nothing when all is sent.
private struct SyncStatusLine: View {
    let notes: NotesModel

    var body: some View {
        if let line {
            HStack(spacing: Tokens.Space.s2) {
                Image(systemName: notes.lastOutcome == .offline ? Symbol.offline : Symbol.sync)
                Text(line)
            }
            .font(Tokens.Font.caption)
            .foregroundStyle(Tokens.Color.textMuted)
            .padding(.vertical, Tokens.Space.s2)
            .frame(maxWidth: .infinity)
            .background(Tokens.Color.bg.opacity(0.92))
        }
    }

    private var line: String? {
        if notes.lastOutcome == .offline { return Copy.Notes.offline }
        if notes.pending > 0 { return Copy.Notes.waiting(notes.pending) }
        return nil
    }
}
