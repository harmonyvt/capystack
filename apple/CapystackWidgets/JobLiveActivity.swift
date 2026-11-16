import ActivityKit
import CapystackKit
import SwiftUI
import WidgetKit

// The demo job's Live Activity (docs/CONTRACT.md section 8): the lock screen card and the Dynamic Island (compact,
// expanded, minimal). The server (or the app while it polls) writes `JobActivityAttributes.ContentState`; this file
// only draws it. Rule: never `.fixedSize()` on a timer Text here (it measures the widest possible value and pushes
// everything else off the island); give it a frame instead.

struct JobLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: JobActivityAttributes.self) { context in
            JobLockScreen(state: context.state, stale: context.isStale)
                .activityBackgroundTint(Tokens.Color.surface)
                .activitySystemActionForegroundColor(Tokens.Color.text)
                .widgetURL(LiveCopy.link(context.attributes.jobId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    JobGlyph(state: context.state)
                        .padding(.leading, Tokens.Space.s1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    JobPercent(state: context.state)
                        .padding(.trailing, Tokens.Space.s1)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.title)
                        .font(Tokens.Font.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    JobExpandedBottom(state: context.state, stale: context.isStale)
                }
            } compactLeading: {
                JobGlyph(state: context.state)
            } compactTrailing: {
                JobPercent(state: context.state)
            } minimal: {
                JobRing(state: context.state, size: 18)
            }
            .keylineTint(Tokens.Color.accent)
            .widgetURL(LiveCopy.link(context.attributes.jobId))
        }
    }
}

/// The few words the island shows (lowercase, no emoji).
enum LiveCopy {
    static func status(_ state: JobActivityAttributes.ContentState, stale: Bool) -> String {
        switch state.state {
        case "done": return "done"
        case "failed": return "didn't finish"
        default: return stale ? "still working, no news for a bit" : "working"
        }
    }

    /// A tap opens the app on the job (`capystack://jobs/<id>`).
    static func link(_ jobID: String) -> URL? {
        var parts = URLComponents()
        parts.scheme = AppConfig.urlScheme
        parts.host = "jobs"
        parts.path = "/" + jobID
        return parts.url
    }
}

// MARK: - lock screen

struct JobLockScreen: View {
    let state: JobActivityAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            HStack(spacing: Tokens.Space.s2) {
                JobGlyph(state: state)
                Text(AppConfig.displayName)
                    .font(Tokens.Font.caption)
                    .foregroundStyle(Tokens.Color.textMuted)
                Spacer(minLength: Tokens.Space.s2)
                UpdatedText(date: state.updatedAt)
            }
            Text(state.title)
                .font(Tokens.Font.headline)
                .foregroundStyle(Tokens.Color.text)
                .lineLimit(1)
            Text(LiveCopy.status(state, stale: stale))
                .font(Tokens.Font.body)
                .foregroundStyle(state.isFailed ? Tokens.Color.danger : Tokens.Color.textMuted)
                .lineLimit(1)
            JobBar(state: state)
        }
        .padding(Tokens.Space.s4)
    }
}

/// "2 min ago", ticking. A timer Text: a fixed frame, never `.fixedSize()`.
struct UpdatedText: View {
    let date: Date

    var body: some View {
        Text(date, style: .relative)
            .font(Tokens.Font.caption)
            .foregroundStyle(Tokens.Color.textMuted)
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .lineLimit(1)
            .frame(maxWidth: 90, alignment: .trailing)
    }
}

// MARK: - island pieces

struct JobExpandedBottom: View {
    let state: JobActivityAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            JobBar(state: state)
            HStack {
                Text(LiveCopy.status(state, stale: stale))
                    .font(Tokens.Font.caption)
                    .foregroundStyle(state.isFailed ? Tokens.Color.danger : Tokens.Color.textMuted)
                    .lineLimit(1)
                Spacer(minLength: Tokens.Space.s2)
                UpdatedText(date: state.updatedAt)
            }
        }
        .padding(.horizontal, Tokens.Space.s2)
    }
}

/// The job's symbol: a bolt while working, a check when done, a warning when it failed.
struct JobGlyph: View {
    let state: JobActivityAttributes.ContentState

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(tint)
    }

    private var symbol: String {
        switch state.state {
        case "done": return "checkmark.circle.fill"
        case "failed": return "exclamationmark.triangle.fill"
        default: return "bolt.fill"
        }
    }

    private var tint: Color {
        switch state.state {
        case "done": return Tokens.Color.success
        case "failed": return Tokens.Color.danger
        default: return Tokens.Color.accent
        }
    }
}

/// "45%" in a fixed width so the compact island never jumps.
struct JobPercent: View {
    let state: JobActivityAttributes.ContentState

    var body: some View {
        Text(state.isFinished ? (state.isFailed ? "!" : "100%") : "\(state.percent)%")
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(state.isFailed ? Tokens.Color.danger : Tokens.Color.text)
            .frame(width: 40, alignment: .trailing)
    }
}

/// The progress bar, drawn by hand (Live Activities animate only what the system animates).
struct JobBar: View {
    let state: JobActivityAttributes.ContentState

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Tokens.Color.border)
                Capsule()
                    .fill(state.isFailed ? Tokens.Color.danger : Tokens.Color.accent)
                    .frame(width: max(6, proxy.size.width * fraction))
            }
        }
        .frame(height: 6)
    }

    private var fraction: CGFloat { CGFloat(state.isFinished && !state.isFailed ? 1 : min(1, max(0, state.progress))) }
}

/// A ring for the minimal island.
struct JobRing: View {
    let state: JobActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().stroke(Tokens.Color.border, lineWidth: 3)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(state.isFailed ? Tokens.Color.danger : Tokens.Color.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }

    private var fraction: CGFloat { CGFloat(state.isFinished ? 1 : min(1, max(0, state.progress))) }
}

#Preview("lock screen", as: .content, using: JobActivityAttributes(jobId: "preview", kind: "demo")) {
    JobLiveActivity()
} contentStates: {
    JobActivityAttributes.ContentState(title: "demo job", progress: 0.4, state: "running", updatedAt: .now)
    JobActivityAttributes.ContentState(title: "demo job", progress: 1, state: "done", updatedAt: .now)
}
