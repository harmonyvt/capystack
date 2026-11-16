#!/usr/bin/env bash
# Tests ./init on a temporary copy of the repo (never touches the real tree).
# Usage: deploy/test-init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/init-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
fails=0
ok()   { echo "  ok    $*"; }
fail() { echo "  FAIL  $*"; fails=$((fails + 1)); }
check() { # description command...
    local d="$1"; shift
    if "$@" >/dev/null 2>&1; then ok "$d"; else fail "$d"; fi
}
tree_hash() { (cd "$1" && find . -type f -not -path './.git/*' -not -path '*/node_modules/*' | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1); }
fresh_copy() { # dest
    mkdir -p "$1"
    (cd "$ROOT" && tar cf - --exclude=node_modules --exclude=.git --exclude=.svelte-kit --exclude=.wrangler --exclude=shots --exclude=.build .) | (cd "$1" && tar xf -)
}
leftovers() { # dir: files (not init/test-init) that still say the template name, or paths that do
    (cd "$1" && { grep -rIl -e capystack -e Capystack -e CAPYSTACK . --exclude-dir=node_modules --exclude-dir=.git --exclude=init --exclude=test-init.sh || true
                  find . \( -iname '*capystack*' \) -not -path '*/node_modules/*' -not -path './.git/*' -not -name init -not -name test-init.sh; })
}

echo "== dry run changes nothing"
A="$TMP/dry"; fresh_copy "$A"
before="$(tree_hash "$A")"
(cd "$A" && ./init notes-app --web-host notes.example.com --api-host notes-api.example.com --bundle-prefix com.example --dry-run >/dev/null)
[ "$before" = "$(tree_hash "$A")" ] && ok "tree identical after --dry-run" || fail "dry run changed the tree"

echo "== real run"
B="$TMP/real"; fresh_copy "$B"
(cd "$B" && ./init notes-app --web-host notes.example.com --api-host notes-api.example.com --bundle-prefix com.example --display "notes app" >"$TMP/init.out" 2>&1) \
    && ok "init exits 0" || { fail "init failed"; cat "$TMP/init.out"; }
left="$(leftovers "$B")"
[ -z "$left" ] && ok "no capystack/Capystack/CAPYSTACK left in files or names" || { fail "leftovers:"; echo "$left" | head -20; }
cfg="$B/app.config.json"
for pair in name=notes-app swiftName=NotesApp webHost=notes.example.com apiHost=notes-api.example.com bundleId=com.example.notes-app \
            appGroup=group.com.example.notes-app urlScheme=notes-app d1Name=notes-app displayName="notes app" \
            secretsFile='~/.config/notes-app/secrets.json'; do
    k="${pair%%=*}"; v="${pair#*=}"
    [ "$(jq -r --arg k "$k" '.[$k]' "$cfg")" = "$v" ] && ok "config $k = $v" || fail "config $k is $(jq -r --arg k "$k" '.[$k]' "$cfg"), want $v"
done
check "app.config.json still valid JSON" jq -e . "$cfg"
[ ! -d "$ROOT/apple/Capystack" ] || { [ -f "$B/apple/NotesApp/Design/Tokens.generated.swift" ] && ok "apple/NotesApp/Design renamed and tokens present" || fail "renamed apple dir lacks tokens"; }
check "tokens up to date in the copy" node "$B/design/build.mjs" --check
check "init and test-init untouched" cmp "$ROOT/init" "$B/init"
check "bash -n deploy/app-deploy" bash -n "$B/deploy/app-deploy"

echo "== refuses a second run"
h1="$(tree_hash "$B")"
if (cd "$B" && ./init other --web-host o.example.com --api-host o-api.example.com --bundle-prefix com.example >/dev/null 2>&1); then fail "second run should refuse"; else ok "second run refused"; fi
[ "$h1" = "$(tree_hash "$B")" ] && ok "tree unchanged by the refused run" || fail "refused run changed the tree"

echo "== --force renames again, and same-args force is a no-op"
(cd "$B" && ./init notes-app --web-host notes.example.com --api-host notes-api.example.com --bundle-prefix com.example --force >"$TMP/noop.out" 2>&1) && ok "force with same names exits 0" || fail "same-name force failed"
grep -q "nothing to change" "$TMP/noop.out" && ok "reported nothing to change" || fail "no-op message missing"
[ "$h1" = "$(tree_hash "$B")" ] && ok "tree unchanged by no-op force" || fail "no-op force changed the tree"
(cd "$B" && ./init second --web-host s.example.org --api-host s-api.example.org --bundle-prefix org.example --force >/dev/null 2>&1) && ok "force to a new name exits 0" || fail "force rename failed"
[ "$(jq -r .name "$B/app.config.json")" = second ] && ok "config now says second" || fail "config name not second"
left="$(cd "$B" && grep -rIl -e notes-app -e NotesApp -e NOTES_APP . --exclude-dir=node_modules --exclude-dir=.git --exclude=init --exclude=test-init.sh || true)"
[ -z "$left" ] && ok "nothing of notes-app left" || { fail "notes-app leftovers:"; echo "$left" | head; }

echo "== bad input"
C="$TMP/bad"; fresh_copy "$C"
if (cd "$C" && ./init "Bad Slug" --web-host a.example.com --api-host b.example.com --bundle-prefix com.example >/dev/null 2>&1); then fail "bad slug accepted"; else ok "bad slug rejected"; fi
if (cd "$C" && ./init good --web-host a.example.com --bundle-prefix com.example >/dev/null 2>&1); then fail "missing --api-host accepted"; else ok "missing flag rejected"; fi
[ "$(jq -r .name "$C/app.config.json")" = capystack ] && ok "bad input left the config alone" || fail "bad input changed the config"

echo
if [ "$fails" -gt 0 ]; then echo "test-init: $fails failure(s)"; exit 1; fi
echo "test-init: all passed"
