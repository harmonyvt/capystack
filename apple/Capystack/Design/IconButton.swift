import SwiftUI

/// An icon-only control (docs/CONTRACT.md section 11: icon-first). Its name is the accessibility label, the pointer's
/// tooltip on the Mac and iPad, and a small tag above it after a long press on a touch screen. The release after a long
/// press does not press it.
struct IconButton: View {
    let systemImage: String
    let label: String
    var role: ButtonRole?
    /// A filled accent circle: the one solid icon of a bar.
    var prominent = false
    let action: () -> Void

    @State private var naming = false
    @State private var swallowNextTap = false
    @State private var hideTask: Task<Void, Never>?

    init(_ label: String, systemImage: String, role: ButtonRole? = nil, prominent: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.systemImage = systemImage
        self.role = role
        self.prominent = prominent
        self.action = action
    }

    var body: some View {
        Button(role: role) {
            if swallowNextTap {
                swallowNextTap = false
                return
            }
            action()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 36, height: 36)
                .contentShape(Circle())
        }
        .buttonStyle(IconButtonStyle(prominent: prominent, destructive: role == .destructive))
        .help(label)
        .accessibilityLabel(label)
        .modifier(NameTagOnHold(label: label, naming: $naming, swallowNextTap: $swallowNextTap, hideTask: $hideTask))
    }
}

private struct IconButtonStyle: ButtonStyle {
    let prominent: Bool
    let destructive: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(ink)
            .background(Circle().fill(fill(configuration.isPressed)))
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .motion(Tokens.Motion.spring, value: configuration.isPressed)
            .frame(minWidth: 44, minHeight: 44)
    }

    private var ink: Color {
        if prominent { return Tokens.Color.accentText }
        return destructive ? Tokens.Color.danger : Tokens.Color.text
    }

    private func fill(_ pressed: Bool) -> Color {
        if prominent { return pressed ? Tokens.Color.accent.opacity(0.85) : Tokens.Color.accent }
        return pressed ? Tokens.Color.surfaceRaised : Tokens.Color.surface
    }
}

/// The long-press name tag.
private struct NameTagOnHold: ViewModifier {
    let label: String
    @Binding var naming: Bool
    @Binding var swallowNextTap: Bool
    @Binding var hideTask: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .simultaneousGesture(LongPressGesture(minimumDuration: 0.45).onEnded { _ in show() })
            .overlay(alignment: .top) { tag }
            .haptic(.selection, trigger: naming, when: { $0 })
    }

    @ViewBuilder private var tag: some View {
        if naming {
            Text(label)
                .font(Tokens.Font.caption)
                .foregroundStyle(Tokens.Color.text)
                .padding(.horizontal, Tokens.Space.s2)
                .padding(.vertical, Tokens.Space.s1)
                .background(Capsule().fill(Tokens.Color.surfaceRaised))
                .fixedSize()
                .offset(y: -36)
                .transition(.opacity)
                .allowsHitTesting(false)
        }
    }

    private func show() {
        swallowNextTap = true
        withAnimation(.easeOut(duration: Tokens.Motion.fast)) { naming = true }
        hideTask?.cancel()
        hideTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.6))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: Tokens.Motion.base)) { naming = false }
            // a long press that ended off the button never delivers its tap: stop waiting for it
            swallowNextTap = false
        }
    }
}
