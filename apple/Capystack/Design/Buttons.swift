import SwiftUI

// The component kit's `Button` (docs/CONTRACT.md section 11) is a style on SwiftUI's own Button, so the name never
// shadows SwiftUI.Button:
//
//   Button(Copy.SignIn.button) { … }.buttonStyle(.primary)       filled accent, one per screen
//   .buttonStyle(.secondary)                                     outlined
//   .buttonStyle(.ghost)                                         text only
//   .buttonStyle(.danger)                                        filled danger, for what cannot be undone
//   .buttonStyle(.kit(.primary, fullWidth: true))                stretches to its container
//
// At least 44 pt tall; presses scale a little (a fade under Reduce Motion).

enum ButtonKind: Sendable, Equatable {
    case primary, secondary, ghost, danger
}

struct KitButtonStyle: ButtonStyle {
    var kind: ButtonKind
    var fullWidth = false

    func makeBody(configuration: Configuration) -> some View {
        KitButtonBody(configuration: configuration, kind: kind, fullWidth: fullWidth)
    }
}

extension ButtonStyle where Self == KitButtonStyle {
    static var primary: KitButtonStyle { KitButtonStyle(kind: .primary) }
    static var secondary: KitButtonStyle { KitButtonStyle(kind: .secondary) }
    static var ghost: KitButtonStyle { KitButtonStyle(kind: .ghost) }
    static var danger: KitButtonStyle { KitButtonStyle(kind: .danger) }
    static func kit(_ kind: ButtonKind, fullWidth: Bool = false) -> KitButtonStyle {
        KitButtonStyle(kind: kind, fullWidth: fullWidth)
    }
}

private struct KitButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: ButtonKind
    let fullWidth: Bool
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(Tokens.Font.headline)
            .foregroundStyle(foreground)
            .lineLimit(1)
            .modifier(ButtonFrame(fullWidth: fullWidth))
            .modifier(ButtonFill(kind: kind, pressed: configuration.isPressed))
            .opacity(isEnabled ? 1 : 0.45)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return Tokens.Color.accentText
        case .danger: return Tokens.Color.accentText
        case .secondary: return Tokens.Color.text
        case .ghost: return Tokens.Color.accent
        }
    }
}

private struct ButtonFrame: ViewModifier {
    let fullWidth: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, Tokens.Space.s5)
            .frame(minHeight: 44)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .contentShape(Capsule())
    }
}

private struct ButtonFill: ViewModifier {
    let kind: ButtonKind
    let pressed: Bool

    func body(content: Content) -> some View {
        content
            .background(Capsule().fill(fill))
            .overlay(Capsule().strokeBorder(stroke, lineWidth: 1))
            .scaleEffect(pressed ? 0.97 : 1)
            .motion(Tokens.Motion.spring, value: pressed)
    }

    private var fill: Color {
        switch kind {
        case .primary: return pressed ? Tokens.Color.accent.opacity(0.85) : Tokens.Color.accent
        case .danger: return pressed ? Tokens.Color.danger.opacity(0.85) : Tokens.Color.danger
        case .secondary: return pressed ? Tokens.Color.surfaceRaised : Tokens.Color.surface
        case .ghost: return pressed ? Tokens.Color.surface : Color.clear
        }
    }

    private var stroke: Color {
        kind == .secondary ? Tokens.Color.border : Color.clear
    }
}
