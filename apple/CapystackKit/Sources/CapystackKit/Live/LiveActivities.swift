import Foundation
#if os(iOS) && canImport(ActivityKit)
import ActivityKit

/// The app's side of the demo job's island (docs/CONTRACT.md section 8):
/// - registers the push-to-start token (`live_start`) and every activity's update token (`live_update`, with
///   `activity_id` = the job id), so the server can start and update islands while the app is closed;
/// - while the app polls a job it also writes the island itself, and starts one locally when the server did not
///   (no push on this server or build, or the start push did not arrive within `startGrace`).
///
/// ActivityKit's `Activity` is not `Sendable`; every use is on the main actor (as cobalt's `ActivityKitJobHandle`).
@MainActor
public final class LiveActivities: JobLiveSink {
    /// How long a job waits for the server's push-to-start before the app starts the island itself.
    public static let startGrace: TimeInterval = 5
    /// How long an ended island stays on the lock screen.
    public static let endDismissal: TimeInterval = 15 * 60

    private let client: any CapystackClient
    private let platform: String
    private var observing = false
    private var tasks: [Task<Void, Never>] = []
    private var watchedActivities: Set<String> = []
    private var sentTokens: Set<String> = []
    private var startedAt: [String: Date] = [:]

    public init(client: any CapystackClient, platform: String) {
        self.client = client
        self.platform = platform
    }

    /// Live Activities are allowed for this app (Settings › capystack › Live Activities).
    public var areEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// Starts watching tokens and activities. Call once signed in on a server with push. Safe to call again.
    public func startObserving() {
        guard !observing else { return }
        observing = true
        // The push-to-start observer starts first: a known iOS bug loses the token when it starts late.
        tasks.append(Task { [weak self] in
            for await data in Activity<JobActivityAttributes>.pushToStartTokenUpdates {
                guard let self else { return }
                await self.register(.liveStart, token: data.hexString, activityID: nil)
            }
        })
        if let data = Activity<JobActivityAttributes>.pushToStartToken {
            let hex = data.hexString
            Task { await self.register(.liveStart, token: hex, activityID: nil) }
        }
        tasks.append(Task { [weak self] in
            for await activity in Activity<JobActivityAttributes>.activityUpdates {
                guard let self else { return }
                self.watch(ActivityBox(activity))
            }
        })
        for activity in Activity<JobActivityAttributes>.activities {
            watch(ActivityBox(activity))
        }
    }

    /// Stops watching (sign-out). Islands on screen are ended.
    public func stop() async {
        for task in tasks { task.cancel() }
        tasks.removeAll()
        observing = false
        watchedActivities.removeAll()
        sentTokens.removeAll()
        for activity in Activity<JobActivityAttributes>.activities {
            await ActivityBox(activity).end(nil, dismissAfter: nil)
        }
    }

    /// The job just started on the server: the clock for the push-to-start grace begins.
    public func jobStarted(_ job: Job) {
        startedAt[job.id] = Date()
    }

    /// The app polled the job: write the island, or start one when the server has not within the grace period.
    /// `serverStarts` is false when this server or build cannot push (then the app starts it at once).
    public func show(_ job: Job, serverStarts: Bool) async {
        let state = JobActivityAttributes.ContentState(job: job)
        if let existing = box(for: job.id) {
            if job.isFinished {
                await existing.end(state, dismissAfter: Self.endDismissal)
                startedAt[job.id] = nil
            } else {
                await existing.update(state)
            }
            return
        }
        guard !job.isFinished, areEnabled else { return }
        let since = startedAt[job.id] ?? Date()
        if serverStarts && Date().timeIntervalSince(since) < Self.startGrace { return }
        let attributes = JobActivityAttributes(jobId: job.id, kind: job.kind)
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(120))
        // pushType nil: a local island (requesting `.token` without the push entitlement throws).
        if let activity = try? Activity.request(attributes: attributes, content: content, pushType: nil) {
            watch(ActivityBox(activity))
        }
    }

    // MARK: - private

    private func box(for jobID: String) -> ActivityBox? {
        Activity<JobActivityAttributes>.activities
            .first { $0.attributes.jobId == jobID && ($0.activityState == .active || $0.activityState == .stale) }
            .map { ActivityBox($0) }
    }

    /// Reports the activity's update tokens with its job id.
    private func watch(_ box: ActivityBox) {
        guard !watchedActivities.contains(box.id) else { return }
        watchedActivities.insert(box.id)
        let jobID = box.jobID
        let stream = box.pushTokens()
        tasks.append(Task { [weak self] in
            for await hex in stream {
                guard let self else { return }
                await self.register(.liveUpdate, token: hex, activityID: jobID)
            }
        })
    }

    private func register(_ kind: PushRegistration.Kind, token: String, activityID: String?) async {
        let signature = "\(kind.rawValue)|\(activityID ?? "")|\(token)"
        guard !sentTokens.contains(signature) else { return }
        sentTokens.insert(signature)
        let registration = PushRegistration(
            kind: kind, token: token, platform: platform, environment: PushEnvironment.current, activityID: activityID)
        do {
            try await client.registerPush(registration)
        } catch {
            sentTokens.remove(signature)            // try again on the next token or launch
        }
    }
}

/// One activity, held on the main actor.
@MainActor
final class ActivityBox {
    nonisolated(unsafe) let activity: Activity<JobActivityAttributes>

    init(_ activity: Activity<JobActivityAttributes>) { self.activity = activity }

    var id: String { activity.id }
    var jobID: String { activity.attributes.jobId }

    func update(_ state: JobActivityAttributes.ContentState) async {
        await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(120)))
    }

    func end(_ state: JobActivityAttributes.ContentState?, dismissAfter seconds: TimeInterval?) async {
        let content = state.map { ActivityContent(state: $0, staleDate: nil) }
        let policy: ActivityUIDismissalPolicy = seconds.map { .after(Date().addingTimeInterval($0)) } ?? .immediate
        await activity.end(content, dismissalPolicy: policy)
    }

    /// The activity's update push tokens as lowercase hex: the current value first, then every change.
    func pushTokens() -> AsyncStream<String> {
        let activity = activity
        return AsyncStream { continuation in
            let task = Task {
                for await data in activity.pushTokenUpdates { continuation.yield(data.hexString) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
#endif
