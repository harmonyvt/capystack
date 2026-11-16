import Foundation
import Observation
import Synchronization

/// A short message at the bottom of the window.
public struct ToastMessage: Identifiable, Equatable, Sendable {
    public enum Kind: Sendable, Equatable { case info, success, error }

    public let id: UUID
    public var text: String
    public var kind: Kind

    public init(_ text: String, kind: Kind = .info) {
        self.id = UUID()
        self.text = text
        self.kind = kind
    }
}

/// The fake worlds `AppModel.preview` can open in.
public enum PreviewScenario: String, CaseIterable, Sendable {
    /// Signed in with a few notes, a chat and two devices.
    case signedIn
    /// First launch: the sign-in screen.
    case signedOut
    /// Signed in, nothing made yet: the empty states.
    case empty
    /// Signed in, nothing reaches the server: writes wait in the outbox.
    case offline
    /// The server refused the token: "sign in again".
    case expired
}

/// The app's state, one per process. Screens read it; every server call goes through its stores.
///
///   signedOut   no token on this device                      the sign-in screen
///   expired     the server refused the token (401)           the sign-in screen with "sign in again";
///                                                            the notes copy and the outbox stay and sync after
///   signedIn    a token                                      the app
@MainActor @Observable
public final class AppModel {
    public enum AuthState: Sendable, Equatable { case signedOut, expired, signedIn }

    public private(set) var auth: AuthState
    public private(set) var capabilities: Capabilities = .unknown
    public private(set) var signingIn = false
    public var toast: ToastMessage?
    /// Settings › haptics.
    public var hapticsEnabled = true

    public let notes: NotesModel
    public let chat: ChatModel
    public let account: AccountModel
    public let jobs: JobsModel
    public let isPreview: Bool

    @ObservationIgnored public let client: any CapystackClient
    @ObservationIgnored let tokens: TokenStore
    @ObservationIgnored private var launched = false
    @ObservationIgnored private var lastDeviceToken: String?
    /// The Live Activity controller on iOS; nil elsewhere and in previews.
    @ObservationIgnored private var liveSink: (any JobLiveSink)?

    public init(client: any CapystackClient, tokens: TokenStore, database: NoteDatabase, isPreview: Bool) {
        self.client = client
        self.tokens = tokens
        self.isPreview = isPreview
        self.auth = tokens.hasToken ? .signedIn : .signedOut
        self.notes = NotesModel(database: database, client: client)
        self.chat = ChatModel(client: client)
        self.account = AccountModel(client: client)
        self.jobs = JobsModel(client: client)
        notes.onSignedOut = { [weak self] in self?.serverRefusedToken() }
    }

    // MARK: - building one

    /// The real app: the API host, the keychain, the notes file.
    public static func live() -> AppModel {
        let relay = SignedOutRelay()
        let tokens = TokenStore.live
        let client = HTTPClient(token: { tokens.token }, onSignedOut: { relay.fire() })
        let model = AppModel(client: client, tokens: tokens, database: .openDefault(), isPreview: false)
        relay.set { [weak model] in
            guard let model else { return }
            Task { @MainActor in model.serverRefusedToken() }
        }
        return model
    }

    /// A model over `PreviewClient` and an in-memory database: no network, no keychain.
    public static func preview(_ scenario: PreviewScenario = .signedIn, latency: Duration = .milliseconds(300)) -> AppModel {
        let data: PreviewData = scenario == .empty ? .empty : .standard
        let options = PreviewClient.Options(
            latency: latency, offline: scenario == .offline, signedOut: scenario == .expired, ai: true, push: false)
        let client = PreviewClient(options, data: data)
        let tokens = TokenStore.memory(token: scenario == .signedOut ? nil : "preview-token")
        let model = AppModel(client: client, tokens: tokens, database: .inMemory(), isPreview: true)
        if scenario == .expired {
            model.auth = .expired
            tokens.clear()
        }
        return model
    }

    // MARK: - lifecycle

    /// Once per process, from the first scene: the server's capabilities, the notes copy, then a sync.
    public func launch() async {
        guard !launched else { return }
        launched = true
        await notes.load()
        await refreshCapabilities()
        if auth == .signedIn { await afterSignIn() }
    }

    /// Back in the foreground: pull what changed.
    public func foreground() async {
        guard launched else { return }
        await refreshCapabilities()
        if auth == .signedIn { await notes.sync() }
    }

    public func refreshCapabilities() async {
        if let caps = try? await client.capabilities() {
            capabilities = caps
            jobs.serverPushes = caps.features.push
        }
    }

    // MARK: - sign-in

    /// docs/CONTRACT.md section 3: a PKCE pair, Access in `web`, the code exchanged for this device's token.
    /// Throws `SignInError` (`.cancelled` when the sheet was closed).
    public func signIn(using web: any WebSignIn) async throws {
        guard !signingIn else { return }
        signingIn = true
        defer { signingIn = false }

        let verifier = AccountAuth.makeVerifier()
        let device = AccountDevice.current
        guard let start = AccountAuth.startURL(
            platform: device.platform, device: device.name, challenge: AccountAuth.challenge(for: verifier))
        else { throw SignInError.badCallback }

        let callback: URL
        do {
            callback = try await web.open(start, callbackScheme: AccountAuth.callbackScheme)
        } catch let error as SignInError {
            throw error
        } catch {
            throw SignInError.failed(.invalidResponse(status: 0))
        }
        guard let code = AccountAuth.code(from: callback) else { throw SignInError.badCallback }

        let result: SignInResult
        do {
            result = try await client.exchange(code: code, verifier: verifier, device: device.name, platform: device.platform)
        } catch let error as APIError {
            throw SignInError.failed(error)
        } catch {
            throw SignInError.failed(.invalidResponse(status: 0))
        }
        do {
            try tokens.save(result.token)
        } catch {
            throw SignInError.couldNotSave
        }
        auth = .signedIn
        await afterSignIn()
    }

    /// Signs this device out: the server revokes the session, the token leaves the keychain, the copy and the outbox go.
    public func signOut() async {
        _ = try? await client.signOut()
        tokens.clear()
        await notes.wipe()
        chat.reset()
        account.reset()
        jobs.reset()
        await liveSink?.stop()
        liveSink = nil
        jobs.live = nil
        lastDeviceToken = nil
        auth = .signedOut
    }

    /// Any keyed route answered 401: "sign in again". The notes copy and the outbox stay for after.
    public func serverRefusedToken() {
        guard auth == .signedIn else { return }
        tokens.clear()
        auth = .expired
    }

    private func afterSignIn() async {
        account.reset()
        chat.reset()
        await notes.sync()
        guard auth == .signedIn else { return }
        startLive()
        await account.refresh()
        await chat.refresh()
    }

    // MARK: - push

    /// The app delegate's APNs device token (`device` kind: the "pull now" hint).
    public func registerDeviceToken(_ token: Data) async {
        let hex = token.hexString
        guard auth == .signedIn, capabilities.features.push, hex != lastDeviceToken else { return }
        lastDeviceToken = hex
        let registration = PushRegistration(
            kind: .device, token: hex, platform: AccountDevice.current.platform, environment: PushEnvironment.current)
        do {
            try await client.registerPush(registration)
        } catch {
            lastDeviceToken = nil
        }
    }

    /// A background push arrived: it only means "pull now".
    public func remoteNotification() async {
        guard auth == .signedIn else { return }
        await notes.sync()
    }

    /// The app asks for remote notifications when this is true.
    public var wantsRemoteNotifications: Bool { auth == .signedIn && capabilities.features.push && !isPreview }

    private func startLive() {
        guard !isPreview, liveSink == nil else { return }
        #if os(iOS) && canImport(ActivityKit)
        let manager = LiveActivities(client: client, platform: AccountDevice.current.platform)
        liveSink = manager
        jobs.live = manager
        if capabilities.features.push { manager.startObserving() }
        #endif
    }

    // MARK: - toast

    public func show(_ text: String, kind: ToastMessage.Kind = .info) {
        toast = ToastMessage(text, kind: kind)
    }
}

/// Lets the HTTP client (built before the model) tell the model the server refused the token.
final class SignedOutRelay: Sendable {
    private let handler = Mutex<(@Sendable () -> Void)?>(nil)

    func set(_ handler: (@Sendable () -> Void)?) {
        self.handler.withLock { $0 = handler }
    }

    func fire() {
        let current = handler.withLock { $0 }
        current?()
    }
}
