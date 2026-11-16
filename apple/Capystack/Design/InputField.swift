import SwiftUI

/// The kit's `TextField` (docs/CONTRACT.md section 11), named `InputField` so it never shadows SwiftUI.TextField:
/// a quiet label above a rounded field. `multiline` grows with its text.
struct InputField: View {
    let label: String?
    let placeholder: String
    @Binding var text: String
    var multiline = false
    var onSubmit: (() -> Void)?

    init(_ label: String? = nil, placeholder: String, text: Binding<String>, multiline: Bool = false, onSubmit: (() -> Void)? = nil) {
        self.label = label
        self.placeholder = placeholder
        self._text = text
        self.multiline = multiline
        self.onSubmit = onSubmit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            if let label {
                Text(label)
                    .font(Tokens.Font.caption)
                    .foregroundStyle(Tokens.Color.textMuted)
            }
            field
                .font(Tokens.Font.body)
                .foregroundStyle(Tokens.Color.text)
                .textFieldStyle(.plain)
                .modifier(FieldChrome())
        }
    }

    @ViewBuilder private var field: some View {
        if multiline {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(1...6)
                .onSubmit { onSubmit?() }
        } else {
            TextField(placeholder, text: $text)
                .onSubmit { onSubmit?() }
        }
    }
}

private struct FieldChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.vertical, Tokens.Space.s2 + 2)
            .background(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous).fill(Tokens.Color.surface))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous).strokeBorder(Tokens.Color.border, lineWidth: 1))
    }
}
