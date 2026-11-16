# DESIGN.md

The product design and style guide. Read it before any UI work, in web or Apple. The look itself lives in
`design/tokens.json`; this file says how to use it. If the two disagree about a value, the tokens win.

## Principles

1. **Calm.** Quiet surfaces, one accent, plenty of space. The app should feel like a good notebook, not a dashboard.
2. **Small and friendly.** Few words, warm tone, no jargon, no blame.
3. **Icon first.** A control is an icon; its name appears on hover (web) or long press (apps) and is always its
   accessibility label. Text buttons are for the one clear primary action on a screen.
4. **Same app everywhere.** Phone, tablet, Mac and web share names, order and copy. Layout regroups; nothing is
   renamed between sizes.
5. **Fast feeling.** Show structure at once (skeletons), animate meaning (springs), confirm with a haptic.
6. **Private by default.** User content is masked from analytics and session replay.

## Voice and copy

- All lowercase, including buttons, titles and errors. Proper nouns the owner types stay as typed.
- The house name is `capystack`, lowercase, in every UI string (after `./init` it is the new app's lowercase name).
- Short sentences, plain words. "note saved", not "your note has been successfully saved".
- Errors say what happened and what to do: "couldn't reach the server. try again." Never a raw code or stack text.
  Never blame the user.
- Empty states say what goes here and how to start: "no notes yet" and "tap + to write your first one."
- No emoji anywhere in the UI, no exclamation marks, no "please".
- Dates are relative when recent ("9:41", "mon", "3 days ago"), absolute after a week.
- Copy lives in one file per area: `web/src/lib/copy.ts` and `apple/Capystack/Design/Copy.swift`. No string literals
  in views. When you add copy, add it to both so the apps agree.

## Layout

- **Icon-first controls** with names on hover/long press (`IconButton`). Destructive icons are never the default focus.
- **Closes top right.** A sheet, popover or full-screen cover has its close icon at the top right, always.
- **Sheets** for create/edit and short tasks. Full pages only for the main tabs. A sheet never opens another sheet.
- **Adaptive navigation.** Width decides, not device: under 600 pt a bottom **tab bar** (notes, settings); from 600 pt
  a **sidebar** (icon + label, 190 pt) with a list/detail split on notes. Same tabs, same order, same names.
- Spacing is the 4 pt scale (`space-1..8`: 4, 8, 12, 16, 20, 24, 32, 48). Screens pad `space-4` on phones and
  `space-6` on wide layouts. Radii: `sm` 8 (chips, tooltips), `md` 12 (fields, rows), `lg` 20 (cards, sheets), `pill`
  (buttons, toasts).
- Touch targets are at least 40 pt (44 pt on Apple); icon buttons are 40 pt circles.
- One primary action per screen; secondary actions are ghost or icon.

## Motion and haptics

- Durations: `fast` 0.15 s (press, hover), `base` 0.25 s (colour, fade), `slow` 0.4 s (sheet, layout). Springs:
  response 0.35, damping 0.8 (`Tokens.Motion.spring`, `--motion-spring-*`).
- Press: scale to 0.96 with `fast`. Sheets rise with the spring. Lists animate insert and delete (fade + 8 pt shift).
- Numbers that change use a numeric transition (SwiftUI `.contentTransition(.numericText())`).
- Always honour Reduce Motion: springs become a 0.2 s crossfade; shimmer stops. The CSS tokens already collapse the
  durations under `prefers-reduced-motion`.
- Haptics (apps), gated by the haptics setting: light tick on a button press, `.selection` when a choice moves,
  `.success` when something lands (saved, copied, signed in), `.warning` when it half lands, `.error` when it fails.
  No haptic for plain scrolling or typing.

## Loading and empty states

- **Skeletons, not spinners.** Draw the shape of what is coming (rows with two grey bars) with the shimmer. A spinner
  is allowed only inside a button that has been pressed, never for page content.
- Show cached content first and refresh behind it; do not blank a screen to reload.
- Empty states use `EmptyState`: icon, one bold line, one hint line, optionally the primary button.
- Errors on a loaded screen are a `Toast`; errors that block a screen replace its content with an `EmptyState` and a
  "try again" button.

## Privacy mask

Any view that draws user content (note text, titles, anything typed or uploaded) wears `.privacyMask()` on Apple
(the PostHog replay mask) and `data-ph-no-capture` on web. New view that draws user content without it is a bug.
Never send user content in analytics properties; send ids, counts and timings only.

## Component kit

Same names on both sides. Web in `web/src/lib/ui/`, SwiftUI in `apple/Capystack/Design/`. Build from tokens only:
no literal colours, sizes or durations in a component.

| component | use it when |
|---|---|
| `Button` (primary, secondary, ghost, danger) | the one clear action (primary), a plain alternative (secondary), a quiet action (ghost), an irreversible one (danger, always behind a confirm) |
| `IconButton` | any toolbar or row action; always set the name (tooltip + accessibility label) |
| `Sheet` | create, edit and short tasks; close icon top right; dismiss by swipe/escape too |
| `ListRow` | any list of things: title, one muted line, trailing time or control |
| `EmptyState` | a list with nothing in it, or a blocked screen |
| `Skeleton` | content is loading; match the shape of the real rows |
| `Toast` | a result that needs no decision ("note saved", an error); auto-dismisses; one at a time |
| `SignInCard` | the sign-in screen; the only place with the logo block |
| `TextField` | any text entry; label above, never placeholder-only |

Need something not on the list? Add it to `mockups/` first, get the owner's OK, then add it to both kits and this
table.

## Mockup-first workflow

1. Mock it in `mockups/` using only tokens (see `mockups/README.md`).
2. Owner OK. No build before it.
3. Build in the real kits with the same names.
4. Screenshot the build (web with `mockups/shoot.mjs`-style Playwright; Apple in the simulator), compare with the
   mockup, fix differences.

## Re-skin

1. Edit `design/tokens.json`: colour pairs (light and dark), the accent, radii, font stack, durations.
2. `node design/build.mjs` writes `web/src/lib/design/tokens.css` and `apple/Capystack/Design/Tokens.generated.swift`.
3. `node design/build.mjs --check` fails when they are stale (it is a gate).
4. `node mockups/shoot.mjs` to see it; keep body text at 4.5:1 contrast on its surface, `accent-text` readable on
   `accent` in both themes.

Never edit the two generated files, and never put a colour literal in a component. The default palette is warm
neutral with a sage-teal accent (light accent `#2b7a68`, dark `#5fb89f`).
