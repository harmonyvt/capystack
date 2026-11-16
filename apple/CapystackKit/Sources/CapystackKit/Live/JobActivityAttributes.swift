import Foundation
#if os(iOS) && canImport(ActivityKit)
import ActivityKit
#endif

/// The demo job's Live Activity (docs/CONTRACT.md section 8). The server push-starts it with
/// `"attributes-type": "JobActivityAttributes"`, `attributes: {jobId, kind}` and a `content-state` with exactly the keys
/// `title`, `progress`, `state`, `updatedAt` (seconds since 1970). Keep the type's name and every key as they are.
public struct JobActivityAttributes: Codable, Hashable, Sendable {
    public struct ContentState: Codable, Hashable, Sendable {
        public var title: String
        /// 0...1.
        public var progress: Double
        /// `running`, `done` or `failed`.
        public var state: String
        public var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case title, progress, state, updatedAt
        }

        public init(title: String, progress: Double, state: String, updatedAt: Date) {
            self.title = title
            self.progress = progress
            self.state = state
            self.updatedAt = updatedAt
        }

        public init(job: Job) {
            self.init(title: job.title, progress: job.progress, state: job.state.rawValue, updatedAt: Millis.date(job.updatedAt))
        }

        /// `updatedAt` is read and written as seconds since 1970 (a number), whatever date strategy the system's coder
        /// uses: ActivityKit's own decoder would otherwise read a number as seconds since 2001.
        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            title = (try? c.decode(String.self, forKey: .title)) ?? ""
            progress = min(1, max(0, (try? c.decode(Double.self, forKey: .progress)) ?? 0))
            state = (try? c.decode(String.self, forKey: .state)) ?? "running"
            let seconds = (try? c.decode(Double.self, forKey: .updatedAt)) ?? 0
            updatedAt = Date(timeIntervalSince1970: seconds)
        }

        public func encode(to encoder: any Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(title, forKey: .title)
            try c.encode(progress, forKey: .progress)
            try c.encode(state, forKey: .state)
            try c.encode(updatedAt.timeIntervalSince1970, forKey: .updatedAt)
        }

        public var isFinished: Bool { state == "done" || state == "failed" }
        public var isFailed: Bool { state == "failed" }
        /// 0...100, for a compact label.
        public var percent: Int { Int((progress * 100).rounded()) }
    }

    public var jobId: String
    public var kind: String

    public init(jobId: String, kind: String) {
        self.jobId = jobId
        self.kind = kind
    }
}

#if os(iOS) && canImport(ActivityKit)
extension JobActivityAttributes: ActivityAttributes {}
#endif
