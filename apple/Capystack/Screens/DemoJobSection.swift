import CapystackKit
import SwiftUI

/// "start demo job": `POST /jobs/demo`, then the job's progress here and in the Live Activity (iOS).
struct DemoJobSection: View {
    let model: AppModel

    var body: some View {
        Section {
            Text(Copy.Settings.demoLine)
                .font(Tokens.Font.body)
                .foregroundStyle(Tokens.Color.textMuted)
            if let job = model.jobs.current {
                JobProgressRow(job: job)
            }
            Button(Copy.Settings.demoStart) { start() }
                .buttonStyle(.kit(.secondary, fullWidth: true))
                .disabled(model.jobs.starting || model.jobs.isRunning)
                .listRowBackground(Color.clear)
        } header: {
            Label(Copy.Settings.demo, systemImage: Symbol.live)
        }
        .haptic(.success, trigger: model.jobs.current?.state, when: { $0 == .done })
        .haptic(.error, trigger: model.jobs.current?.state, when: { $0 == .failed })
    }

    private func start() {
        Task {
            do {
                try await model.jobs.startDemo(seconds: 20)
                Analytics.event("demo_job_started")
            } catch {
                model.show(Copy.message(for: error) ?? Copy.Common.retry, kind: .error)
            }
        }
    }
}

private struct JobProgressRow: View {
    let job: Job

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            HStack {
                Text(job.title)
                    .font(Tokens.Font.body)
                    .foregroundStyle(Tokens.Color.text)
                Spacer()
                Text(status)
                    .font(Tokens.Font.caption)
                    .foregroundStyle(job.state == .failed ? Tokens.Color.danger : Tokens.Color.textMuted)
                    .monospacedDigit()
            }
            ProgressView(value: job.progress)
                .tint(job.state == .failed ? Tokens.Color.danger : Tokens.Color.accent)
                .motion(Tokens.Motion.spring, value: job.progress)
        }
        .padding(.vertical, Tokens.Space.s1)
    }

    private var status: String {
        switch job.state {
        case .running: return "\(Copy.Settings.demoRunning) \(Int((job.progress * 100).rounded()))%"
        case .done: return Copy.Settings.demoDone
        case .failed: return Copy.Settings.demoFailed
        }
    }
}
