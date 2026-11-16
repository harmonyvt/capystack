import CapystackKit
import SwiftUI

/// A short message at the bottom (`AppModel.toast`), gone after a moment or a tap.
struct Toast: View {
    let message: ToastMessage

    var body: some View {
        HStack(spacing: Tokens.Space.s2) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            Text(message.text)
                .font(Tokens.Font.body)
                .foregroundStyle(Tokens.Color.text)
                .lineLimit(2)
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, Tokens.Space.s3)
        .background(Capsule().fill(Tokens.Color.surfaceRaised))
        .overlay(Capsule().strokeBorder(Tokens.Color.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch message.kind {
        case .info: return "info.circle"
        case .success: return Symbol.check
        case .error: return Symbol.warning
        }
    }

    private var tint: Color {
        switch message.kind {
        case .info: return Tokens.Color.accent
        case .success: return Tokens.Color.success
        case .error: return Tokens.Color.danger
        }
    }
}

/// Shows `model.toast` over the content, with a haptic for successes and errors.
struct ToastHost: ViewModifier {
    let model: AppModel

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) { overlay }
            .motion(Tokens.Motion.spring, value: model.toast)
            .haptic(.success, trigger: model.toast?.id, when: { _ in model.toast?.kind == .success })
            .haptic(.error, trigger: model.toast?.id, when: { _ in model.toast?.kind == .error })
    }

    @ViewBuilder private var overlay: some View {
        if let toast = model.toast {
            Toast(message: toast)
                .padding(.bottom, Tokens.Space.s7)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .onTapGesture { model.toast = nil }
                .task(id: toast.id) {
                    try? await Task.sleep(for: .seconds(2.5))
                    if model.toast?.id == toast.id { model.toast = nil }
                }
        }
    }
}

extension View {
    func toastHost(_ model: AppModel) -> some View {
        modifier(ToastHost(model: model))
    }
}
