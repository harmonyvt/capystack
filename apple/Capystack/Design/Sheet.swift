import SwiftUI

/// A sheet's content with its header: the title on the left, close at the top right (docs/CONTRACT.md section 11).
/// Present it with SwiftUI's `.sheet`; close uses the environment's `dismiss`.
///
///     .sheet(isPresented: $showing) { Sheet(title: "summary") { Text(summary) } }
struct Sheet<Content: View>: View {
    let title: String
    let content: Content
    @Environment(\.dismiss) private var dismiss

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView {
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Tokens.Space.s5)
            }
        }
        .background(Tokens.Color.bg)
        .modifier(SheetSizing())
    }

    private var header: some View {
        HStack(spacing: Tokens.Space.s3) {
            Text(title)
                .font(Tokens.Font.title)
                .foregroundStyle(Tokens.Color.text)
            Spacer(minLength: 0)
            IconButton(Copy.Common.close, systemImage: Symbol.close) { dismiss() }
        }
        .padding(.horizontal, Tokens.Space.s5)
        .padding(.top, Tokens.Space.s4)
        .padding(.bottom, Tokens.Space.s2)
    }
}

/// Medium and large detents on iPhone; a sensible window size on the Mac.
private struct SheetSizing: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content.frame(minWidth: 420, idealWidth: 480, minHeight: 320, idealHeight: 420)
        #else
        content.presentationDetents([.medium, .large])
        #endif
    }
}
