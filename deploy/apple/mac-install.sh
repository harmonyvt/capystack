#!/usr/bin/env bash
# Build the macOS app (Release), sign it with this Mac's Developer ID for local use, and install it to /Applications.
#
# Usage: deploy/apple/mac-install.sh        (or: deploy/app-deploy mac)
#
# Local install facts:
#   - NOT sandboxed: there is no provisioning profile for a Developer ID build here, so an app group / keychain group
#     would be refused. The app falls back to its own store under ~/Library/Application Support and the login
#     keychain. The sandboxed build (with the app group) is the TestFlight one: `deploy/app-deploy mac testflight`.
#   - Hardened runtime on, not notarized (spctl says "Unnotarized Developer ID": expected for a local install).
#   - It quits a running copy (osascript) before replacing it.
#
# Needs: xcodegen, xcodebuild, codesign, a "Developer ID Application" identity in the keychain, jq.
# App name and Swift prefix come from app.config.json.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPLE="$ROOT/apple"
die() { echo "mac-install.sh: $*" >&2; exit 1; }
case "${1:-}" in -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;; esac
command -v jq >/dev/null || die "missing tool: jq"
command -v xcodegen >/dev/null || die "missing tool: xcodegen"
SLUG="$(jq -r '.name' "$ROOT/app.config.json")"
SWIFT="$(jq -r '.swiftName' "$ROOT/app.config.json")"
LOG="${TMPDIR:-/tmp}/$SLUG-mac-release.log"
ENT="$(mktemp -t "$SLUG-mac-entitlements").plist"

cd "$APPLE"
xcodegen generate >/dev/null
xcodebuild -project "$SWIFT.xcodeproj" -scheme "$SWIFT" -configuration Release -destination 'platform=macOS' \
    -derivedDataPath .build/mac-release CODE_SIGNING_ALLOWED=NO build > "$LOG" 2>&1 || true
grep -E '\*\* BUILD (SUCCEEDED|FAILED)' "$LOG" | tail -1
grep -q '\*\* BUILD SUCCEEDED \*\*' "$LOG" || die "build failed, see $LOG"

APP="$(find .build/mac-release/Build/Products/Release -maxdepth 1 -name '*.app' | head -1)"
[ -n "$APP" ] || die "no .app in .build/mac-release"
echo "built: $APP"

# DEBUG-only launch switches must not ship in a Release binary (their names contain "${SWIFT}DebugOnly").
BIN="$APP/Contents/MacOS/$(basename "$APP" .app)"
if [ -f "$BIN" ] && strings "$BIN" | grep -q "${SWIFT}DebugOnly"; then
    die "Release binary still contains ${SWIFT}DebugOnly (a DEBUG-only switch); refusing to install"
fi

# Empty entitlements: add the ones this app needs when it needs them (for example photos-library).
cat > "$ENT" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
</dict></plist>
XML

ID="$(security find-identity -v -p codesigning | grep 'Developer ID Application' | head -1 | awk '{print $2}')"
[ -n "$ID" ] || die "no 'Developer ID Application' identity in the keychain"

# nested code first (frameworks, plugins, helpers), then the app
find "$APP/Contents" \( -name '*.framework' -o -name '*.dylib' -o -name '*.appex' -o -name '*.xpc' \) -prune -print 2>/dev/null |
while read -r nested; do
    codesign --force --options runtime --timestamp=none --sign "$ID" "$nested" >/dev/null
done
codesign --force --options runtime --timestamp=none --entitlements "$ENT" --sign "$ID" "$APP"
codesign --verify --deep --strict "$APP" && echo "signature ok"

NAME="$(basename "$APP")"
PROC="$(basename "$NAME" .app)"
if pgrep -x "$PROC" >/dev/null; then
    osascript -e "quit app \"$PROC\"" || true
    sleep 1
fi
rm -rf "/Applications/$NAME"
ditto "$APP" "/Applications/$NAME"
PLIST="/Applications/$NAME/Contents/Info.plist"
echo "installed /Applications/$NAME version $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST") ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST"))"
rm -f "$ENT"
