import Foundation
import Observation

/// The demo job (`POST /jobs/demo`): starts it, polls `GET /jobs/:id` every 2 s while the app is open, and keeps the
/// Live Activity in step on iOS (the server starts and updates it by push when it can; see `LiveActivities`).
@MainActor @Observable
public final class JobsModel {
    public private(set) var current: Job?
    public private(set) var starting = false

    @ObservationIgnored private let client: any CapystackClient
    @ObservationIgnored private var poll: Task<Void, Never>?
    /// Whether the server can push to this build (features.push); set by `AppModel`.
    @ObservationIgnored var serverPushes = false
    /// Time between polls (tests shorten it).
    @ObservationIgnored var interval: Duration = .seconds(2)
    /// The Live Activity on iOS; nil elsewhere.
    @ObservationIgnored var live: (any JobLiveSink)?

    init(client: any CapystackClient) {
        self.client = client
    }

    public var isRunning: Bool { current.map { !$0.isFinished } ?? false }

    /// Starts a demo job of `seconds` (5...120).
    public func startDemo(seconds: Int = 20) async throws {
        guard !starting, !isRunning else { return }
        starting = true
        defer { starting = false }
        let job = try await client.startDemoJob(seconds: min(120, max(5, seconds)))
        current = job
        live?.jobStarted(job)
        follow(job.id)
    }

    /// Polls until the job ends. Returns at once; the loop runs on the main actor.
    func follow(_ id: String) {
        poll?.cancel()
        poll = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                try? await Task.sleep(for: self.interval)
                if Task.isCancelled { return }
                guard let job = try? await self.client.job(id: id) else { continue }
                self.current = job
                await self.live?.show(job, serverStarts: self.serverPushes)
                if job.isFinished { return }
            }
        }
    }

    /// Waits for the poll loop to end (tests).
    func waitUntilFinished() async {
        await poll?.value
    }

    func reset() {
        poll?.cancel()
        poll = nil
        current = nil
    }
}
