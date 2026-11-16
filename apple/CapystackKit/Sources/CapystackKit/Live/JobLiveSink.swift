import Foundation

/// Where the demo job's progress goes besides the screen: the Live Activity on iOS (`LiveActivities`). A protocol, so
/// the models hold one on every platform without `#if` around stored properties (the `@Observable` macro skips those).
@MainActor
public protocol JobLiveSink: AnyObject {
    /// Watch tokens and activities (signed in, the server can push).
    func startObserving()
    /// The job just started on the server.
    func jobStarted(_ job: Job)
    /// The app polled the job. `serverStarts`: the server can push-start the island.
    func show(_ job: Job, serverStarts: Bool) async
    /// Sign-out: stop watching, end what is on screen.
    func stop() async
}
