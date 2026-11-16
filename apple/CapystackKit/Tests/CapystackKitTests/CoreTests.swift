import Foundation
import Testing
@testable import CapystackKit

@Suite struct EndpointTests {
    @Test func fillsIdSegments() {
        let e = Endpoint(method: "PATCH", path: "/notes/:id")
        #expect(e.path(id: "abc") == "/notes/abc")
        #expect(e.path(["id": "a b/c"]) == "/notes/a%20b%2Fc")
    }

    @Test func leavesUnknownSegmentsAndPlainPaths() {
        #expect(Endpoint(method: "GET", path: "/notes").path(id: "x") == "/notes")
        #expect(Endpoint(method: "POST", path: "/notes/:id/summarize").path(id: "n1") == "/notes/n1/summarize")
        #expect(Endpoint.hasParameters("/notes/:id"))
        #expect(!Endpoint.hasParameters("/notes"))
    }

    @Test func routesUseTheGeneratedNames() {
        #expect(Route.note.method == "GET")
        #expect(Route.updateNote.method == "PATCH")
        #expect(Route.deleteNote.method == "DELETE")
        #expect(Route.sync.path == "/sync")
        #expect(Route.exchange.path == "/auth/exchange")
        #expect(Route.revokeKey.path(id: "k1") == "/auth/keys/k1")
    }
}

@Suite struct PKCETests {
    @Test func verifierIsBase64url43() {
        let v = AccountAuth.makeVerifier()
        #expect(v.count == 43)
        #expect(v.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        #expect(AccountAuth.makeVerifier() != v)
    }

    @Test func challengeMatchesRFC7636() {
        #expect(AccountAuth.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r-wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func startURLCarriesEverything() throws {
        let url = try #require(AccountAuth.startURL(platform: "ios", device: "harmony's iphone+1", challenge: "abc"))
        #expect(url.absoluteString.hasPrefix("https://capystack.capybaraharmony.com/api/auth/app?"))
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(items.first { $0.name == "challenge" }?.value == "abc")
        #expect(items.first { $0.name == "platform" }?.value == "ios")
        #expect(items.first { $0.name == "device" }?.value == "harmony's iphone+1")
        #expect(url.absoluteString.contains("%2B1"))
    }

    @Test func readsTheCallbackCode() {
        #expect(AccountAuth.code(from: URL(string: "capystack://signed-in?code=abcDEF123_-xyz0")!) == "abcDEF123_-xyz0")
        #expect(AccountAuth.code(from: URL(string: "capystack://signed-in")!) == nil)
        #expect(AccountAuth.code(from: URL(string: "capystack://other?code=abcDEF123_-xyz0")!) == nil)
        #expect(AccountAuth.code(from: URL(string: "https://signed-in?code=abcDEF123_-xyz0")!) == nil)
        #expect(AccountAuth.code(from: URL(string: "capystack://signed-in?code=bad%20code!!")!) == nil)
    }

    @Test func cleansDeviceNames() {
        #expect(AccountDevice.clean("  Harmony's iPhone \n", fallback: "iphone") == "harmony's iphone")
        #expect(AccountDevice.clean(nil, fallback: "mac") == "mac")
        #expect(AccountDevice.clean(String(repeating: "a", count: 60), fallback: "x").count == 40)
    }
}

@Suite struct DecodingTests {
    @Test func note() throws {
        let json = #"{"note":{"id":"n1","title":"t","body":"b","created_at":1700000000000,"updated_at":1700000001000}}"#
        let n = try Wire.decode(Note.self, from: Data(json.utf8), key: "note")
        #expect(n == Note(id: "n1", title: "t", body: "b", createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000))
        // bare, with nulls
        let bare = try Wire.decode(Note.self, from: Data(#"{"id":"n2","title":null,"body":"x","created_at":5}"#.utf8), key: "note")
        #expect(bare.title == "" && bare.updatedAt == 5)
    }

    @Test func noteDisplayTitleFallsBackToTheBody() {
        #expect(Note(id: "a", title: "  ", body: "\nfirst line\nsecond", createdAt: 0, updatedAt: 0).displayTitle == "first line")
    }

    @Test func capabilities() throws {
        let full = #"{"name":"capystack","version":"1.2","features":{"ai":true,"push":false,"posthog":true,"mcp":true},"posthog":{"host":"https://us.i.posthog.com","token":"phc_x"}}"#
        let caps = try JSONDecoder().decode(Capabilities.self, from: Data(full.utf8))
        #expect(caps.features.ai && caps.features.mcp && !caps.features.push)
        #expect(caps.postHogProject?.token == "phc_x")
        let bare = try JSONDecoder().decode(Capabilities.self, from: Data(#"{"name":"capystack","features":{"posthog":true},"posthog":{"host":"https://x","token":""}}"#.utf8))
        #expect(bare.postHogProject == nil)
        #expect(bare.version == "")
        let none = try JSONDecoder().decode(Capabilities.self, from: Data(#"{}"#.utf8))
        #expect(none == Capabilities.unknown)
    }

    @Test func sessionAndKeys() throws {
        let json = #"{"sessions":[{"id":"s1","kind":"session","name":"iphone","device":"my phone","platform":"ios","created_at":1,"last_used_at":null,"expires_at":9}]}"#
        let list = try Wire.decode([Session].self, from: Data(json.utf8), key: "sessions")
        #expect(list.count == 1 && list[0].label == "my phone" && list[0].lastUsedAt == nil && list[0].expiresAt == 9)
        let created = try JSONDecoder().decode(CreatedKey.self, from: Data(#"{"key":{"id":"k1","name":"mcp","created_at":3,"last_used_at":null},"token":"tok"}"#.utf8))
        #expect(created.key.name == "mcp" && created.token == "tok")
        let exchange = try JSONDecoder().decode(SignInResult.self, from: Data(#"{"token":"t","session":{"id":"s","kind":"session","name":"n","device":null,"platform":"mac","created_at":1,"last_used_at":1,"expires_at":2}}"#.utf8))
        #expect(exchange.session.platform == "mac")
    }

    @Test func job() throws {
        let job = try Wire.decode(Job.self, from: Data(#"{"job":{"id":"j","kind":"demo","state":"weird","progress":1.5,"title":"demo","created_at":1,"updated_at":2}}"#.utf8), key: "job")
        #expect(job.state == .running && job.progress == 1)
    }

    @Test func chatMessageShapes() throws {
        let decoder = JSONDecoder()
        let a = try decoder.decode(ChatMessage.self, from: Data(#"{"id":"1","role":"user","text":"hi","created_at":1}"#.utf8))
        #expect(a.text == "hi" && a.isUser)
        let b = try decoder.decode(ChatMessage.self, from: Data(#"{"id":"2","role":"assistant","content":[{"type":"text","text":"one"},{"type":"tool_use","id":"t"},{"type":"text","text":"two"}]}"#.utf8))
        #expect(b.text == "one\ntwo")
        let c = try decoder.decode(ChatMessage.self, from: Data(#"{"id":"3","role":"assistant","content_json":"[{\"type\":\"text\",\"text\":\"from json\"}]"}"#.utf8))
        #expect(c.text == "from json")
        let d = try decoder.decode(ChatMessage.self, from: Data(#"{"id":"4","role":"user","content":[{"type":"tool_result","content":"x"}]}"#.utf8))
        #expect(!d.isVisible)
    }

    @Test func syncPage() throws {
        let json = #"{"since":0,"next":7,"more":true,"notes":[{"id":"a","title":"","body":"","created_at":1,"updated_at":1}],"gone":[{"entity":"note","id":"b"},{"entity":"other","id":"c"}]}"#
        let page = try JSONDecoder().decode(SyncPage.self, from: Data(json.utf8))
        #expect(page.next == 7 && page.more && page.notes.count == 1)
        #expect(page.goneNoteIDs == ["b"])
    }

    @Test func liveContentStateKeysAndDates() throws {
        let state = JobActivityAttributes.ContentState(title: "demo", progress: 0.5, state: "running", updatedAt: Date(timeIntervalSince1970: 1_700_000_000))
        let data = try JSONEncoder().encode(state)
        let parsed = try JSONSerialization.jsonObject(with: data)
        let object = try #require(parsed as? [String: Any])
        #expect(Set(object.keys) == ["title", "progress", "state", "updatedAt"])
        #expect(object["updatedAt"] as? Double == 1_700_000_000)
        // the server's push payload: updatedAt in whole seconds since 1970
        let pushed = try JSONDecoder().decode(
            JobActivityAttributes.ContentState.self,
            from: Data(#"{"title":"demo","progress":1,"state":"done","updatedAt":1700000100}"#.utf8))
        #expect(pushed.updatedAt == Date(timeIntervalSince1970: 1_700_000_100) && pushed.isFinished && pushed.percent == 100)
        let attrs = try JSONSerialization.jsonObject(with: JSONEncoder().encode(JobActivityAttributes(jobId: "j", kind: "demo"))) as? [String: Any]
        #expect(attrs?["jobId"] as? String == "j" && attrs?["kind"] as? String == "demo")
    }
}

@Suite struct APIErrorTests {
    @Test func mapsStatusesAndCodes() {
        #expect(APIError.from(status: 401, data: Data(#"{"error":"auth.required"}"#.utf8)) == .signedOut)
        #expect(APIError.from(status: 401, data: Data()) == .signedOut)
        let gone = APIError.from(status: 410, data: Data(#"{"error":"sync.too_old"}"#.utf8))
        #expect(gone.code == APIError.syncTooOld && gone.status == 410)
        let off = APIError.from(status: 503, data: Data(#"{"error":"ai.off","message":"no key"}"#.utf8))
        #expect(off.code == "ai.off" && off.message == "no key" && off.isRetryable)
        let missing = APIError.from(status: 404, data: Data("not json".utf8))
        #expect(missing.isNotFound && missing.code == "not_found" && !missing.isRetryable)
        #expect(APIError.from(status: 400, data: Data(#"{"error":{"code":"input.bad"}}"#.utf8)).code == "input.bad")
        #expect(APIError.network(code: -1009).isOffline && APIError.network(code: -1009).isRetryable)
    }
}
