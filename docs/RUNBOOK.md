# RUNBOOK.md

First-time setup and day-to-day operations. Replace the names below with yours after `./init` (they are rewritten
for you in this file). Commands run from the repo root. Production steps need the owner at the keyboard.

## 0. Tools

On any machine: Node 22+, npm, git, jq, the global Cloudflare CLI `cf` (`cf auth login`, or `CLOUDFLARE_API_TOKEN`).
Install `cf` globally; `npx cf` fails D1 migrations. Docker only if the optional container is switched on.
On a Mac, for the apps: Xcode, `xcodegen` (`brew install xcodegen`).

`deploy/app-deploy doctor` checks all of it and tells you what is missing.

## 1. Name the app

    ./init <slug> --web-host <host> --api-host <host> --bundle-prefix <com.you> [--display <name>]

Example: `./init notes --web-host notes.example.com --api-host notes-api.example.com --bundle-prefix com.example`.
The API host is one subdomain level (`notes-api.example.com`, not `api.notes.example.com`) so Universal SSL covers it.
`deploy/test-init.sh` shows what it does on a throwaway copy.

## 2. Cloudflare

1. **Domain.** The zone for your hosts must be on Cloudflare. The deploy attaches the custom domains itself; DNS
   records are created for the Workers' domains on first deploy.
2. **D1.** `cf d1 create <slug>`; copy the database id into `app.config.json` as `d1Id`. (`d1Name` is already the slug.)
   Pick the region near the owner or near where the API will run, then set `placementRegion` (default
   `aws:ap-southeast-2`; `cf workers placement regions list` names them) to be next to it: sequential D1 calls from a
   far edge cost about 190 ms each (docs/LESSONS.md).
3. **Access (Zero Trust).** Dashboard, Zero Trust, Access, Applications, Add, Self-hosted:
   - application domain: your web host (not the API host);
   - policy "owner": action Allow, include Emails, your email only;
   - login method: One-time PIN.
   Copy the application's **AUD tag** into `app.config.json` (`accessAud`), your team domain (`xxxx.cloudflareaccess.com`)
   into `accessTeamDomain`, and your email into `ownerEmail`.
4. **The API host is not behind Access.** The web app's cross-origin fetches carry no cookies; the API is locked by
   per-owner Bearer keys instead.

## 3. Secrets file

    mkdir -p ~/.config/<slug> && chmod 700 ~/.config/<slug>
    cat > ~/.config/<slug>/secrets.json <<'JSON'
    {
      "ANTHROPIC_API_KEY": "",
      "APNS_KEY_P8": "",
      "APNS_KEY_ID": "",
      "APNS_TEAM_ID": ""
    }
    JSON
    chmod 600 ~/.config/<slug>/secrets.json

A flat JSON object. Every key must exist; an empty string turns the feature off (the API reports it in
`GET /capabilities` `features`):

| key | feature | where it comes from |
|---|---|---|
| `ANTHROPIC_API_KEY` | `features.ai`: note summaries, chat | console.anthropic.com, API keys |
| `APNS_KEY_P8` | `features.push`: device pushes, Live Activities | the `.p8` file's whole text as ONE JSON string (see below) |
| `APNS_KEY_ID` | same | the 10-character key id |
| `APNS_TEAM_ID` | same | the 10-character Apple team id |

The authority is `api/cloudflare.config.ts` (`bindings.secret()` entries); `deploy/app-deploy` lists the same names in
`SECRET_KEYS`. Add a secret in both.

Put the `.p8` in without pasting it anywhere (keeps `\n` escapes):

    node -e 'const fs=require("fs"),p=process.env.HOME+"/.config/<slug>/secrets.json",j=JSON.parse(fs.readFileSync(p));
      j.APNS_KEY_P8=fs.readFileSync(process.argv[1],"utf8");j.APNS_KEY_ID="<key id>";j.APNS_TEAM_ID="<team id>";
      fs.writeFileSync(p,JSON.stringify(j,null,2))' ~/Downloads/AuthKey_XXXXXXXXXX.p8

Never commit the secrets file, never print it, never paste a key into chat. Rotating: edit the file, redeploy the API.

## 4. PostHog (optional)

Create a project at posthog.com (US or EU cloud). Put the project token (public-safe, starts `phc_`) into
`app.config.json` as `posthogToken` and the host (`https://us.i.posthog.com` or `https://eu.i.posthog.com`) as
`posthogHost`. Empty token means analytics off everywhere. The server sends an `op` event per call, the apps and the web
read the token from `/capabilities`. Views that draw user content wear the privacy mask (DESIGN.md).

## 5. Apple (on a Mac)

1. **Team id.** developer.apple.com, Membership details: 10 characters. Put `DEVELOPMENT_TEAM = <team id>` in
   `apple/Config/Local.xcconfig` (gitignored).
2. **APNs key.** developer.apple.com, Certificates, Identifiers & Profiles, Keys, +: enable Apple Push Notifications
   service. Download `AuthKey_<id>.p8` once. Put it in the secrets file as above. One key serves sandbox and
   production.
3. **App Store Connect API key** (for TestFlight; cloud signing needs the Admin role). App Store Connect, Users and
   Access, Integrations, App Store Connect API, Team Keys, +. Download the key once, then:

       mv ~/Downloads/AuthKey_<key id>.p8 ~/.config/<slug>/ && chmod 600 ~/.config/<slug>/*.p8
       printf '{"keyId":"%s","issuerId":"%s","keyPath":"~/.config/<slug>/AuthKey_%s.p8","teamId":"%s"}\n' \
         <key id> <issuer id> <key id> <team id> > ~/.config/<slug>/appstoreconnect.json
       chmod 600 ~/.config/<slug>/appstoreconnect.json

   (An individual key has no issuer id and cannot sign; with only `{"teamId": "..."}` the script signs through the Apple
   ID signed in under Xcode, Settings, Accounts.)
4. **App record.** App Store Connect, Apps, +, New App, platform iOS, the bundle id from `app.config.json`.
   Then TestFlight, Internal Testing, add a group with yourself and automatic distribution.
5. `deploy/app-deploy ios testflight --dry-run` proves signing without uploading. Details and the Mac side:
   `deploy/apple/README.md`.

## 6. Deploy order

    deploy/app-deploy doctor                  # everything green first
    deploy/app-deploy migrate                 # remote D1 (confirms; --dry-run lists what is pending)
    deploy/app-deploy api --dry-run           # builds, uploads nothing
    deploy/app-deploy api
    deploy/app-deploy web
    deploy/app-deploy ios testflight          # on a Mac, once the app record exists
    deploy/app-deploy mac testflight          # optional, same app record with the macOS platform added

The migration goes first and the API before the web (the web reads what the API offers). Every production run asks you to
type the operation (for example `deploy api`). Agents never pass `--yes` unless the owner typed an explicit yes naming
that operation in the conversation.

Check afterwards: `curl -s https://<api host>/capabilities` answers `{name, version, features, ...}`; open the web host,
sign in with the one-time PIN, make a note.

## 7. MCP (use the app from Claude)

Make a key: web app, settings, "keys for tools", new key (shown once). Then:

- **Claude Code:**

      claude mcp add --transport http <slug> https://<api host>/mcp --header "Authorization: Bearer <key>"

- **claude.ai / Claude desktop:** Settings, Connectors, Add custom connector, name `<slug>`, URL
  `https://<api host>/mcp`. The custom connector form has no field for a header, so use a key-in-URL link only if the
  app offers one; otherwise use Claude Code, or a local proxy that adds the header. (Check `docs/CONTRACT.md` section 7
  and the API lane's notes for the current auth shape.)
- **ChatGPT:** Settings, Connectors, developer mode, add custom MCP server, same URL. After a deploy that changes tools,
  press Refresh on the connection.

Claude desktop caches `tools/list`: after changing tools, remove and re-add the connector (docs/LESSONS.md).

Prompt set after a deploy: "list my notes" (`notes_list`), "make a note called test" (`notes_create`), "summarize that
note" (`notes_summarize`, needs the Anthropic key), "show my notes" (the `show_notes` widget).

## 8. Day to day

- Gates before any deploy: see AGENTS.md, Gates.
- Logs: `cf observability telemetry query --body '{...,"parameters":{"datasets":["cloudflare-workers"]}}'`.
- Rotate a Bearer key: revoke it in the web UI and make a new one; clients re-enter it. Sessions (signed-in devices)
  are listed and revocable in settings.
- Re-skin: DESIGN.md, "Re-skin".
- New migration: add `d1/migrations/NNNN_name.sql` (never edit an applied one), then `deploy/app-deploy migrate`.
- Accepted trade-offs: the per-isolate rate limit is not global; a revoked key still works for up to 60 s (the lookup
  cache); session tokens live in localStorage on web.
