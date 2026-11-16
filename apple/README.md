# capystack for Apple

One multiplatform SwiftUI app (iPhone, iPad, Mac; not Catalyst) and an iOS widget extension for the demo job's Live
Activity. iOS 18 / macOS 15, Swift 6 with complete concurrency checking. The only third-party package is `posthog-ios`,
in the app target only.

```
project.yml                      XcodeGen spec (Capystack.xcodeproj is generated and gitignored)
Config/                          Info.plists (written by XcodeGen), entitlements, Signing.xcconfig, Local.xcconfig.example
CapystackKit/                    Swift package: models, API client, sign-in, offline notes store, Live Activity types, previews
  Sources/CapystackKit/API/Endpoints.generated.swift    written by api/scripts/gen.mjs (do not edit)
Capystack/                       the app: App/ (entry, shell, analytics), Screens/, Design/ (component kit, copy, haptics)
  Design/Tokens.generated.swift                          written by design/build.mjs (do not edit)
CapystackWidgets/                the Live Activity (lock screen and Dynamic Island)
```

The contract for everything here is `docs/CONTRACT.md` (sections 3, 4, 5, 8, 9 and 11).

## Build and test (on a Mac)

From the repo root. Install XcodeGen once (`brew install xcodegen`). Run `npm run gen` in `api/` and
`node design/build.mjs` first if the two generated files are missing.

```sh
cd apple && xcodegen generate && cd ..

xcodebuild -project apple/Capystack.xcodeproj -scheme Capystack \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=27.0' \
  -derivedDataPath apple/.build/ios CODE_SIGNING_ALLOWED=NO build

xcodebuild -project apple/Capystack.xcodeproj -scheme Capystack \
  -destination 'platform=macOS' \
  -derivedDataPath apple/.build/mac CODE_SIGNING_ALLOWED=NO build

(cd apple/CapystackKit && swift test)
```

`swift test` needs no network and no simulator: the tests run the SQLite store, the sync engine and the app model
against `PreviewClient`, an in-memory fake of the API.

Previews and the simulator can run with no server: launch with `-previewScenario signedIn` (or `signedOut`, `empty`,
`offline`, `expired`) in a DEBUG build and the app uses `AppModel.preview(...)`.

## Signing

Nothing in git names a team. For device builds, push, the app group and keychain sharing:

1. `cp apple/Config/Local.xcconfig.example apple/Config/Local.xcconfig` and set `DEVELOPMENT_TEAM` (gitignored).
2. In the Apple developer portal, register `com.capybaraharmony.capystack` and `com.capybaraharmony.capystack.widgets`
   with automatic signing, enable Push Notifications and App Groups, and create the app group
   `group.com.capybaraharmony.capystack`.
3. For push from the API, create an APNs key (`.p8`) and put `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID` in the
   API's secrets (see `docs/RUNBOOK.md`). Without them `features.push` is false and the app updates the Live Activity
   itself while it is open.

Unsigned builds (`CODE_SIGNING_ALLOWED=NO`) have no keychain: DEBUG builds then keep the session token in a file in
the app's own container so sign-in still works in the simulator; release builds never do.

## How it works

- **Sign-in** (section 3): `AppModel.signIn(using:)` makes a PKCE pair, opens
  `https://capystack.capybaraharmony.com/api/auth/app` in `WebAuthenticationSession` (Cloudflare Access), reads the
  one-time code from `capystack://signed-in?code=…`, then `POST /auth/exchange`. The token goes to the keychain (app
  group access group). Any 401 (`auth.required`) puts the app in "sign in again"; the notes copy and outbox stay.
- **Notes, offline-first** (section 5): `NoteDatabase` (SQLite) holds the copy and an outbox. Every write lands
  locally, then `SyncEngine` sends the outbox with `Idempotency-Key` and pulls `GET /sync?since=` until `more` is false.
  `410 sync.too_old` drops the copy and pulls from 0. A silent `device` push only triggers a pull.
- **Live Activity** (section 8): `JobActivityAttributes { jobId, kind }` with content state
  `{ title, progress, state, updatedAt }` (seconds since 1970). The app registers `live_start` and `live_update`
  tokens (`activity_id` = job id); when the server cannot push, the app starts and updates the island while it polls.
- **PostHog** (section 9): configured from `/capabilities`; views with user content wear `.privacyMask()`.
- **Endpoints**: only `CapystackKit/Sources/CapystackKit/API/Routes.swift` names generated endpoints, so a renamed
  op breaks the build in one place.
