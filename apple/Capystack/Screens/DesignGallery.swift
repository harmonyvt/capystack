import CapystackKit
import SwiftUI

/// Every component of the kit on one page, in the current appearance (docs/CONTRACT.md section 11).
struct DesignGallery: View {
    let model: AppModel
    @State private var field = ""
    @State private var showingSheet = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Space.s7) {
                GallerySection(Copy.Gallery.buttons) { buttons }
                GallerySection(Copy.Gallery.icons) { icons }
                GallerySection(Copy.Gallery.rows) { rows }
                GallerySection(Copy.Gallery.field) {
                    InputField(Copy.Gallery.fieldLabel, placeholder: Copy.Gallery.fieldPlaceholder, text: $field)
                }
                GallerySection(Copy.Gallery.toast) {
                    Button(Copy.Gallery.showToast) { model.show(Copy.Gallery.toastText, kind: .success) }
                        .buttonStyle(.secondary)
                }
                GallerySection(Copy.Gallery.sheet) {
                    Button(Copy.Gallery.openSheet) { showingSheet = true }
                        .buttonStyle(.secondary)
                }
                GallerySection(Copy.Gallery.skeleton) { SkeletonList(rows: 2).frame(height: 120) }
                GallerySection(Copy.Gallery.empty) {
                    EmptyState(systemImage: Symbol.empty, title: Copy.Notes.emptyTitle, message: Copy.Notes.emptyLine)
                        .frame(height: 220)
                }
                GallerySection(Copy.Gallery.signInCard) { SignInCard {} }
                GallerySection(Copy.Gallery.colors) { ColorSwatches() }
            }
            .padding(Tokens.Space.s5)
        }
        .background(Tokens.Color.bg)
        .navigationTitle(Copy.Gallery.title)
        .sheet(isPresented: $showingSheet) {
            Sheet(title: Copy.Gallery.sheet) {
                Text(Copy.Gallery.sheetLine)
                    .font(Tokens.Font.body)
                    .foregroundStyle(Tokens.Color.text)
            }
        }
    }

    private var buttons: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            Button(Copy.Gallery.primary) {}.buttonStyle(.primary)
            Button(Copy.Gallery.secondary) {}.buttonStyle(.secondary)
            Button(Copy.Gallery.ghost) {}.buttonStyle(.ghost)
            Button(Copy.Gallery.danger) {}.buttonStyle(.danger)
            Button(Copy.Gallery.primary) {}.buttonStyle(.primary).disabled(true)
        }
    }

    private var icons: some View {
        HStack(spacing: Tokens.Space.s3) {
            IconButton(Copy.Notes.new, systemImage: Symbol.add, prominent: true) {}
            IconButton(Copy.Notes.summarize, systemImage: Symbol.summarize) {}
            IconButton(Copy.Settings.copy, systemImage: Symbol.copy) {}
            IconButton(Copy.Notes.delete, systemImage: Symbol.delete, role: .destructive) {}
        }
    }

    private var rows: some View {
        VStack(spacing: Tokens.Space.s2) {
            ListRow(Copy.Gallery.rowTitle, subtitle: Copy.Gallery.rowSubtitle, systemImage: Symbol.notes)
            ListRow(Copy.Gallery.rowTitle, subtitle: Copy.Gallery.rowSubtitle) {
                IconButton(Copy.Settings.revoke, systemImage: Symbol.delete, role: .destructive) {}
            }
        }
    }
}

private struct GallerySection<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            Text(title)
                .font(Tokens.Font.headline)
                .foregroundStyle(Tokens.Color.textMuted)
            content
        }
    }
}

private struct ColorSwatches: View {
    private let swatches: [(String, Color)] = [
        ("bg", Tokens.Color.bg), ("surface", Tokens.Color.surface), ("surface-raised", Tokens.Color.surfaceRaised),
        ("text", Tokens.Color.text), ("text-muted", Tokens.Color.textMuted), ("border", Tokens.Color.border),
        ("accent", Tokens.Color.accent), ("accent-text", Tokens.Color.accentText), ("danger", Tokens.Color.danger),
        ("success", Tokens.Color.success),
    ]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: Tokens.Space.s3)], spacing: Tokens.Space.s3) {
            ForEach(swatches, id: \.0) { swatch in
                VStack(alignment: .leading, spacing: Tokens.Space.s1) {
                    RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous)
                        .fill(swatch.1)
                        .frame(height: 48)
                        .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous).strokeBorder(Tokens.Color.border))
                    Text(swatch.0)
                        .font(Tokens.Font.caption)
                        .foregroundStyle(Tokens.Color.textMuted)
                }
            }
        }
    }
}
