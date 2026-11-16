import Foundation
import Testing
@testable import CapystackKit

@MainActor
@Suite struct AppModelTests {
    @Test func signInStoresTheTokenAndSyncs() async throws {
        let model = AppModel.preview(.signedOut, latency: .zero)
        #expect(model.auth == .signedOut)
        await model.launch()
        try await model.signIn(using: PreviewWebSignIn(seconds: 0))
        #expect(model.auth == .signedIn)
        #expect(model.tokens.hasToken)
        #expect(model.notes.notes.count == PreviewData.standard.notes.count)
        #expect(model.account.me?.id == PreviewData.standard.me.id)
    }

    @Test func cancelledSheetChangesNothing() async throws {
        let model = AppModel.preview(.signedOut, latency: .zero)
        await #expect(throws: SignInError.cancelled) {
            try await model.signIn(using: PreviewWebSignIn(outcome: .cancelled, seconds: 0))
        }
        await #expect(throws: SignInError.badCallback) {
            try await model.signIn(using: PreviewWebSignIn(outcome: .broken, seconds: 0))
        }
        #expect(model.auth == .signedOut)
    }

    @Test func notesAreOfflineFirst() async throws {
        let model = AppModel.preview(.offline, latency: .zero)
        await model.launch()
        let created = await model.notes.create(title: "on the train", body: "no signal")
        let made = try #require(created)
        #expect(model.notes.notes.first?.id == made.id)
        await model.notes.sync()
        #expect(model.notes.lastOutcome == .offline)
        #expect(model.notes.pending == 1)
        await model.notes.update(id: made.id, title: "on the train", body: "still no signal")
        #expect(model.notes.note(id: made.id)?.body == "still no signal")
    }

    @Test func refusedTokenAsksToSignInAgainAndKeepsNotes() async throws {
        let model = AppModel.preview(.signedIn, latency: .zero)
        await model.launch()
        let count = model.notes.notes.count
        #expect(count > 0)
        model.serverRefusedToken()
        #expect(model.auth == .expired)
        #expect(!model.tokens.hasToken)
        #expect(model.notes.notes.count == count)
    }

    @Test func signOutWipesTheCopy() async throws {
        let model = AppModel.preview(.signedIn, latency: .zero)
        await model.launch()
        await model.signOut()
        #expect(model.auth == .signedOut)
        #expect(model.notes.notes.isEmpty)
        #expect(model.account.me == nil)
    }

    @Test func chatRoundTrip() async throws {
        let model = AppModel.preview(.signedIn, latency: .zero)
        await model.launch()
        let thread = try await model.chat.newThread()
        try await model.chat.send("how many notes?", in: thread.id)
        let shown = model.chat.visibleMessages(thread.id)
        #expect(shown.count == 2)
        #expect(shown.first?.isUser == true)
    }

    @Test func demoJobRunsToDone() async throws {
        let model = AppModel.preview(.signedIn, latency: .zero)
        await model.launch()
        model.jobs.interval = .milliseconds(1)
        try await model.jobs.startDemo(seconds: 10)
        await model.jobs.waitUntilFinished()
        #expect(model.jobs.current?.state == .done)
        #expect(!model.jobs.isRunning)
    }
}
