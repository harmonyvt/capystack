import SwiftUI

// Haptics on meaningful changes (docs/CONTRACT.md section 11), as cobalt's Motion.swift: every haptic reads the owner's
// setting from the environment, and a nil feedback plays nothing.

private struct HapticsEnabledKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// `AppModel.hapticsEnabled`, pushed down from the shell.
    var hapticsEnabled: Bool {
        get { self[HapticsEnabledKey.self] }
        set { self[HapticsEnabledKey.self] = newValue }
    }
}

private struct EnvironmentHaptic<T: Equatable>: ViewModifier {
    @Environment(\.hapticsEnabled) private var enabled
    let feedback: SensoryFeedback
    let trigger: T
    let accepts: (T, T) -> Bool

    func body(content: Content) -> some View {
        content.sensoryFeedback(trigger: trigger) { old, new in
            enabled && accepts(old, new) ? feedback : nil
        }
    }
}

private struct ReducedMotionAnimation<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let animation: Animation
    let value: V

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? .easeOut(duration: Tokens.Motion.fast) : animation, value: value)
    }
}

extension View {
    /// Plays `feedback` whenever `trigger` changes (and haptics are on).
    func haptic<T: Equatable>(_ feedback: SensoryFeedback, trigger: T) -> some View {
        modifier(EnvironmentHaptic(feedback: feedback, trigger: trigger, accepts: { _, _ in true }))
    }

    /// Plays `feedback` only when `trigger` changes to a value `accepts` takes.
    func haptic<T: Equatable>(_ feedback: SensoryFeedback, trigger: T, when accepts: @escaping (T) -> Bool) -> some View {
        modifier(EnvironmentHaptic(feedback: feedback, trigger: trigger, accepts: { _, new in accepts(new) }))
    }

    /// `.animation(_, value:)` that becomes a short fade under Reduce Motion.
    func motion<V: Equatable>(_ animation: Animation = Tokens.Motion.spring, value: V) -> some View {
        modifier(ReducedMotionAnimation(animation: animation, value: value))
    }
}
