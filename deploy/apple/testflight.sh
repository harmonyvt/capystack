#!/usr/bin/env bash
# Archive the app signed for App Store Connect and upload it to TestFlight (iOS, or the Mac with --mac).
#
# Usage: deploy/apple/testflight.sh [--mac] [--dry-run] [--build <n>] [--keep-archive]
#
#   --mac            the Mac app (sandboxed, a signed .pkg) instead of the iOS app; same app record (universal purchase)
#   --dry-run        archive and export a signed App Store ipa (or pkg) into apple/.build/testflight/; upload nothing
#   --build <n>      use this build number (default: one past the newest in the TestFlight log and apple/project.yml)
#   --keep-archive   keep the .xcarchive (default: deleted after the export to save disk; the dSYMs are copied first)
#
# Everything app-specific (name, Swift prefix, bundle id, app group) comes from app.config.json. Run it through
# deploy/app-deploy (`app-deploy ios testflight`), which also asks for the owner's confirmation.
#
# Signing is automatic: xcodebuild signs in to the developer account with the App Store Connect API key below
# (-allowProvisioningUpdates), registers the bundle ids, the app group and push for the app and its extensions, and
# makes the distribution certificate and profiles itself. Nothing is installed in the keychain by hand.
#
# Needs: xcodegen, Xcode, jq, plutil, and either the Apple ID of the team signed in to Xcode (Settings > Accounts) with
# "teamId" in the config or DEVELOPMENT_TEAM in apple/Config/Local.xcconfig, or a TEAM API key in
# ~/.config/<slug>/appstoreconnect.json (chmod 600, never committed):
#   {"keyId": "<key id>", "issuerId": "<uuid>", "keyPath": "~/.config/<slug>/AuthKey_<keyId>.p8", "teamId": "<10 chars>"}
# The key needs the Admin role (cloud-managed distribution signing). Setup: docs/RUNBOOK.md and deploy/apple/README.md.
# The Mac needs the macOS platform added to the app record once (README, "TestFlight for the Mac").
# Never prints the key or its contents.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPLE="$ROOT/apple"
CONFIG="$ROOT/app.config.json"

die() { echo "testflight.sh: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1"; }
step() { printf '\n==> %s\n' "$*"; }

DRY_RUN=0
KEEP_ARCHIVE=0
PLATFORM=ios
BUILD_ARG=""

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --mac|--macos) PLATFORM=mac ;;
        --keep-archive) KEEP_ARCHIVE=1 ;;
        --build)
            [ $# -ge 2 ] || die "--build needs a number"
            BUILD_ARG="$2"
            shift
            ;;
        -h|--help)
            sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) die "unknown argument: $1 (see --help)" ;;
    esac
    shift
done

need jq
[ -f "$CONFIG" ] || die "missing $CONFIG"
SLUG="$(jq -r '.name' "$CONFIG")"
DISPLAY_NAME="$(jq -r '.displayName' "$CONFIG")"
SWIFT="$(jq -r '.swiftName' "$CONFIG")"
BUNDLE_ID="$(jq -r '.bundleId' "$CONFIG")"
APP_GROUP="$(jq -r '.appGroup' "$CONFIG")"
for v in SLUG SWIFT BUNDLE_ID APP_GROUP; do [ -n "${!v}" ] && [ "${!v}" != null ] || die "app.config.json is missing a value for $v"; done

CFG_DIR="$HOME/.config/$SLUG"
ASC_CONFIG="${CAPYSTACK_ASC_CONFIG:-$CFG_DIR/appstoreconnect.json}"
DSYM_ROOT="${CAPYSTACK_DSYM_DIR:-$HOME/$SLUG-dsyms}"
BUILD_LOG_DIR="${CAPYSTACK_BUILD_DIR:-$HOME/$SLUG-builds}"
TF_LOG="$BUILD_LOG_DIR/testflight.tsv"

for tool in xcodegen xcodebuild plutil ditto; do need "$tool"; done

# --- App Store Connect key and team ---------------------------------------------------------------

# Two ways to sign in, picked by the config: a TEAM API key (keyId + issuerId + the .p8; works with nobody signed in to
# Xcode), or, when the config has no issuerId (no file, or an individual key, which xcodebuild cannot use), the Apple ID
# signed in under Xcode > Settings > Accounts, which signs and uploads the same way.
KEY_ID=""; ISSUER_ID=""; KEY_PATH=""; TEAM_ID=""
if [ -f "$ASC_CONFIG" ]; then
    KEY_ID="$(jq -r '.keyId // empty' "$ASC_CONFIG")"
    ISSUER_ID="$(jq -r '.issuerId // empty' "$ASC_CONFIG")"
    KEY_PATH="$(jq -r '.keyPath // empty' "$ASC_CONFIG")"
    TEAM_ID="$(jq -r '.teamId // empty' "$ASC_CONFIG")"
fi
case "$ISSUER_ID" in *[!0-9A-Fa-f-]*) ISSUER_ID="" ;; esac       # a placeholder left in is no issuer id
if [ -z "$TEAM_ID" ] && [ -f "$APPLE/Config/Local.xcconfig" ]; then
    TEAM_ID="$(sed -n 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*\([A-Z0-9]\{10\}\).*$/\1/p' \
        "$APPLE/Config/Local.xcconfig" | head -n 1)"
fi
case "$TEAM_ID" in [A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]) ;;
    *) die "no team id: set \"teamId\" in $ASC_CONFIG or DEVELOPMENT_TEAM in apple/Config/Local.xcconfig" ;; esac
if [ -n "$ISSUER_ID" ]; then
    KEY_PATH="${KEY_PATH/#\~/$HOME}"
    [ -n "$KEY_PATH" ] || KEY_PATH="$CFG_DIR/AuthKey_$KEY_ID.p8"
    case "$KEY_ID" in ""|*[!A-Za-z0-9]*) die "$ASC_CONFIG: keyId must be the key id (letters and digits, from the file name)" ;; esac
    [ -f "$KEY_PATH" ] || die "the API key file is missing: $KEY_PATH"
    AUTH=(-allowProvisioningUpdates
          -authenticationKeyPath "$KEY_PATH"
          -authenticationKeyID "$KEY_ID"
          -authenticationKeyIssuerID "$ISSUER_ID")
    echo "signing in with the App Store Connect team key $KEY_ID"
else
    AUTH=(-allowProvisioningUpdates)
    echo "signing in with the Apple ID in Xcode > Settings > Accounts (no team key with an issuer id in ${ASC_CONFIG/#"$HOME"/\~})"
fi

# --- version and build number ---------------------------------------------------------------------

yml_setting() { # key
    sed -n "s/^[[:space:]]*$1:[[:space:]]*\"\{0,1\}\([0-9][0-9.]*\)\"\{0,1\}[[:space:]]*\$/\1/p" "$APPLE/project.yml" | head -n 1
}
VERSION="$(yml_setting MARKETING_VERSION)"
YML_BUILD="$(yml_setting CURRENT_PROJECT_VERSION)"
[ -n "$VERSION" ] || die "could not read MARKETING_VERSION from apple/project.yml"

if [ -n "$BUILD_ARG" ]; then
    case "$BUILD_ARG" in ""|*[!0-9]*) die "--build must be a whole number" ;; esac
    BUILD="$BUILD_ARG"
else
    step "build number"
    TF_MAX=0
    [ -f "$TF_LOG" ] && TF_MAX="$(awk -F'\t' '$2 ~ /^[0-9]+$/ && $2 > m { m = $2 } END { print m + 0 }' "$TF_LOG")"
    BUILD=$((TF_MAX + 1))
    [ "${YML_BUILD:-0}" -gt "$BUILD" ] && BUILD="$YML_BUILD"
    echo "build $BUILD (newest TestFlight $TF_MAX, project.yml ${YML_BUILD:-?})"
fi

if [ "$PLATFORM" = mac ]; then
    DESTINATION='generic/platform=macOS'; LABEL="Mac"; KIND=pkg; TAG="mac-"
else
    DESTINATION='generic/platform=iOS'; LABEL="iOS"; KIND=ipa; TAG=""
fi

OUT="$APPLE/.build/testflight"
ARCHIVE="$OUT/$SLUG-$TAG$VERSION-$BUILD.xcarchive"
EXPORT_DIR="$OUT/export-$TAG$VERSION-$BUILD"
LOG="$OUT/xcodebuild.log"
mkdir -p "$OUT"
rm -rf "$ARCHIVE" "$EXPORT_DIR"

step "$DISPLAY_NAME $LABEL $VERSION ($BUILD) for TestFlight$([ "$DRY_RUN" -eq 1 ] && echo ", DRY RUN: nothing will be uploaded")"

# --- archive --------------------------------------------------------------------------------------

step "xcodegen generate"
(cd "$APPLE" && xcodegen generate)

step "xcodebuild archive (Release, signed by team $TEAM_ID)"
if ! xcodebuild \
    -project "$APPLE/$SWIFT.xcodeproj" \
    -scheme "$SWIFT" \
    -configuration Release \
    -destination "$DESTINATION" \
    -archivePath "$ARCHIVE" \
    "${AUTH[@]}" \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    CURRENT_PROJECT_VERSION="$BUILD" \
    archive >"$LOG" 2>&1; then
    tail -n 40 "$LOG" >&2
    die "archive failed; full log: $LOG"
fi
tail -n 2 "$LOG"
APP="$(find "$ARCHIVE/Products/Applications" -maxdepth 1 -name '*.app' | head -n 1)"
[ -n "$APP" ] && [ -d "$APP" ] || die "archive finished but no .app is in it"

# DEBUG-only launch switches must not ship. Convention: their names contain "${SWIFT}DebugOnly" (LESSONS.md).
if [ "$PLATFORM" = mac ]; then BIN_DIR="$APP/Contents/MacOS"; else BIN_DIR="$APP"; fi
BIN="$BIN_DIR/$(basename "$APP" .app)"
if [ -f "$BIN" ] && strings "$BIN" | grep -q "${SWIFT}DebugOnly"; then
    die "the Release binary still contains ${SWIFT}DebugOnly (a DEBUG-only switch); refusing to upload"
fi

if [ "$PLATFORM" = mac ]; then
    # A Mac App Store build must be sandboxed (TestFlight refuses it otherwise) and carry the app group.
    ents="$(codesign -d --entitlements - --xml "$APP" 2>/dev/null || true)"
    grep -q com.apple.security.app-sandbox <<<"$ents" || die "the archived Mac app is not sandboxed"
    grep -q com.apple.security.network.client <<<"$ents" || die "the archived Mac app has no network client entitlement"
    grep -q "$APP_GROUP" <<<"$ents" || die "the archived Mac app is not signed with the app group $APP_GROUP"
    echo "sandboxed, network client and app group present"
fi

# --- dSYMs (they symbolicate crash stacks later; TestFlight gets its own copy via uploadSymbols) ---

DSYM_DIR="$DSYM_ROOT/$TAG$VERSION-$BUILD"
mkdir -p "$DSYM_DIR"
count=0
for d in "$ARCHIVE"/dSYMs/*.dSYM; do
    [ -d "$d" ] || continue
    ditto "$d" "$DSYM_DIR/$(basename "$d")"
    count=$((count + 1))
done
echo "copied $count dSYM bundles to $DSYM_DIR"

# --- export (and upload) --------------------------------------------------------------------------

DEST=upload
[ "$DRY_RUN" -eq 1 ] && DEST=export
OPTIONS="$OUT/ExportOptions.plist"
cat >"$OPTIONS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key><string>app-store-connect</string>
    <key>destination</key><string>$DEST</string>
    <key>teamID</key><string>$TEAM_ID</string>
    <key>signingStyle</key><string>automatic</string>
    <key>uploadSymbols</key><true/>
    <key>manageAppVersionAndBuildNumber</key><false/>
    <key>testFlightInternalTestingOnly</key><true/>
</dict>
</plist>
PLIST
plutil -lint "$OPTIONS" >/dev/null || die "ExportOptions.plist is not valid"

step "xcodebuild -exportArchive (destination: $DEST)"
if ! xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$OPTIONS" \
    "${AUTH[@]}" >>"$LOG" 2>&1; then
    tail -n 40 "$LOG" >&2
    die "export$([ "$DEST" = upload ] && echo "/upload") failed; full log: $LOG"
fi
tail -n 3 "$LOG"

if [ "$DRY_RUN" -eq 1 ]; then
    file="$(ls "$EXPORT_DIR"/*."$KIND" 2>/dev/null | head -n 1 || true)"
    [ -n "$file" ] || die "export finished but no $KIND in $EXPORT_DIR"
    echo "signed App Store $KIND (not uploaded): $file"
else
    mkdir -p "$BUILD_LOG_DIR"
    # One log for both platforms (column 5 says which), so iOS and the Mac share one rising build number.
    printf '%s\t%s\t%s\t%s\t%s\n' "$VERSION" "$BUILD" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo -)" "$PLATFORM" >>"$TF_LOG"
    echo "uploaded $DISPLAY_NAME $LABEL $VERSION ($BUILD); App Store Connect takes about 5 to 15 minutes to process it,"
    echo "then it appears in TestFlight for the internal testing group. Logged in ${TF_LOG/#"$HOME"/\~}."
fi

if [ "$KEEP_ARCHIVE" -eq 0 ]; then
    rm -rf "$ARCHIVE"
    [ "$DRY_RUN" -eq 1 ] || rm -rf "$EXPORT_DIR"
fi
