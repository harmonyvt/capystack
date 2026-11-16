# Apple deploys

Scripts for getting the app onto devices. They read the app's names from `app.config.json`; run them through
`deploy/app-deploy` (it asks for the owner's confirmation). All of it runs on a Mac with Xcode and `xcodegen`.

| command | does |
|---|---|
| `deploy/app-deploy ios testflight [--dry-run] [--build n] [--commit ref]` | archive the iOS app signed for App Store Connect and upload to TestFlight (internal testing only) |
| `deploy/app-deploy mac testflight [--dry-run]` | the same for the sandboxed Mac app, a signed pkg, same app record (universal purchase) |
| `deploy/app-deploy mac` | build, sign with your Developer ID and install into /Applications, unsandboxed, for local use |

`--dry-run` archives and exports a signed ipa or pkg into `apple/.build/testflight/` and uploads nothing: it proves
signing before the app record exists.

## One-time setup

Full steps are in `docs/RUNBOOK.md`, section 5. In short: team id in `apple/Config/Local.xcconfig`
(`DEVELOPMENT_TEAM = <team id>`), an App Store Connect team API key (Admin role) in
`~/.config/<slug>/appstoreconnect.json`, the app record in App Store Connect with the bundle id from `app.config.json`, an
internal TestFlight group with automatic distribution.

Signing is automatic: `xcodebuild -allowProvisioningUpdates` with the API key registers the bundle ids, the app group and
push for the app and its extensions and makes the certificates and profiles. Nothing is installed in the keychain by hand.

## Build numbers

One past the newest number in `~/<slug>-builds/testflight.tsv` (one line per upload, column 5 says `ios` or `mac`) or
`CURRENT_PROJECT_VERSION` in `apple/project.yml`, whichever is higher; iOS and Mac share the sequence. `--build <n>`
overrides. Bump `MARKETING_VERSION` in `apple/project.yml` when the user-facing version changes.

## TestFlight for the Mac

Add the macOS platform to the app record once (App Store Connect, the app, the + next to the iOS platform, Add Platform,
macOS): same bundle id, so no new record. The archive is refused unless it is sandboxed, has the network client
entitlement and the app group. The unsandboxed local install has no app group (no provisioning profile), so the app falls
back to its own store; use the TestFlight build when you need the group.

## Live Activities on TestFlight

A TestFlight build reads as the production APNs environment. Without the APNs secrets the activity only updates while the
app is open; with them the server keeps it current (docs/RUNBOOK.md, secrets). Check `GET /capabilities` shows
`features.push: true`.

## dSYMs

Every run copies the Release dSYMs to `~/<slug>-dsyms/<version>-<build>/`. Keep them: they symbolicate crash stacks from
that build later (`dwarfdump --uuid <dSYM>` matches a crash to its dSYM).

## Debug-only switches

A binary that contains `<Swift>DebugOnly` (the naming convention for DEBUG-only launch switches) is refused by both
scripts. See `docs/LESSONS.md`.
