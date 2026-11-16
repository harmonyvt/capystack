# CLAUDE.md

Read `AGENTS.md` first (stack, repo map, gates, rules). Read `DESIGN.md` before any UI work, and `docs/CONTRACT.md`
before any cross-folder change. This file adds only what is specific to Claude.

## Delegation policy

The main thread orchestrates: direction, dispatch prompts, gating, review, artifacts and git. Substantive work goes to
named Claude lanes with the model pinned by agent type: `opus-lane` for judgment calls, review and deep research;
`sonnet-lane` / `sonnet-quick` for implementation, scripts, lookups and runtime verification. Never delegate to any other
engine. Lanes own disjoint files (the repo map's owner column), never commit or push, and their reports are checked
against the files and a real run of the gates before anything is called done. Say "not compiled" for Swift written
without a Mac.

## Production

Never run a production deploy, remote migration or TestFlight upload on your own. Dry runs are fine
(`deploy/app-deploy api --dry-run`). A real run needs the owner's typed yes naming that operation, then
`deploy/app-deploy <target>` (it asks again by name). Never pass `--yes` unprompted.

## Apple builds and Remote Control

Swift builds, `xcodebuild`, `swift test`, TestFlight and the Mac install run only on a Mac. From a Linux or cloud session,
start a Remote Control session on the owner's Mac for them and report what ran there. Do not claim an Apple gate passed
from a Linux session.

## Memory and contract hygiene

- `docs/CONTRACT.md` is the source of truth. When a decision changes it, edit the contract in the same change and
  mention it in the report; never leave code and contract disagreeing.
- Keep this file and `AGENTS.md` short and current. Put runtime lessons in `docs/LESSONS.md` (problem, then rule), setup
  in `docs/RUNBOOK.md`, style in `DESIGN.md`; do not duplicate them here.
- Do not store secrets, keys or tokens in memory files, commits, fixtures or chat. Treat `~/.config/<slug>/` as
  off-limits to read aloud.
- Do not write report or summary markdown files into the repo; reports go in the reply.
- When you learn something expensive (a runtime surprise, a failed deploy cause), add it to `docs/LESSONS.md` as problem
  and rule in the same change.
