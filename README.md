# WhatsApp-content-moderation

A localised, background-hosted "digital curtain" for a personal WhatsApp account. It links to the account as a headless companion device (via [Baileys](https://github.com/WhiskeySockets/Baileys)), runs incoming messages from an operator-chosen set of monitored contacts through an LLM classifier, deletes flagged messages locally ("delete for me"), sends a warning, and temporarily blocks a contact after repeated strikes (unless that contact has escalation turned off).

## Status

**Pre-release.** The moderation pipeline, block/unblock scheduler, manual override routines, and the multi-contact web control app are all built and have been validated against real WhatsApp accounts — see [`docs/decisions.md`](docs/decisions.md) for how, and for the full design history. This has **not** been run against a real contact for real moderation yet: the moderation policy is still the placeholder default. Leave shadow mode on (the default) and review its logs before pointing this at anyone — see [`docs/roadmap.md`](docs/roadmap.md) for the remaining checklist.

## Quick start

Requirements: [Docker Compose](https://docs.docker.com/compose/install/) and a phone with WhatsApp, to scan a QR code the first time you link the account. Nothing else — no repo clone, no config files to write first.

```sh
mkdir whatsapp-moderation && cd whatsapp-moderation
curl -O https://raw.githubusercontent.com/BSoDium/WhatsApp-content-moderation/main/docker-compose.yml
docker compose up -d
docker compose exec ollama ollama pull llama3.2:3b
docker compose logs -f --no-log-prefix app   # scan the QR code shown here; Ctrl+C once connected
```

Open `http://<this-machine's-address>:4756` (`http://localhost:4756` on the same machine) and add a contact to the monitored roster — every incoming message from a monitored contact is now buffered, classified, and acted on. Everyone else is ignored.

Everything else — the moderation policy, the classifier model, warning behavior, strike/block timings, and shadow mode itself — starts at a safe default and is edited live from that page, no restart needed. **Shadow mode is on by default**: the app classifies and logs but takes no action. Review the Activity panel against real traffic before turning it off in Settings.

No second WhatsApp number to test with? Add `TEST_ALLOW_SELF: "1"` under `environment:` in `docker-compose.yml` and add your own account to the roster instead.

By default the control app is reachable by anyone on your local network — the page shows a warning banner saying so. See [Restricting access with Tailscale](#restricting-access-with-tailscale) below to lock it down to one identity instead.

To update later: `docker compose pull && docker compose up -d`.

## Web control app

A small web app hosted by the same process (`src/web/`) — this is where contacts actually get moderated, and the only way to add one to the roster. A scrollable list shows every contact Baileys has learned about so far (a contact who's never messaged and isn't in your phone's synced address book will only show up as a bare number), searchable by name or number, each with a switch that directly turns moderation on/off. Clicking a contact (not the switch) opens a detail panel — strikes, block status, a pause switch, an escalation switch (turn off auto-blocking for a contact you can't afford to actually block — the rest of moderation still runs), an unblock button, a "Message history" link into the activity panel, and (once monitored) a **moderation context** field: free text folded into the classifier prompt for that contact only, alongside the global policy — e.g. "this is my landlord, be lenient about payment disputes." The page follows the OS/browser's light/dark preference automatically.

- **Activity panel** — roster-wide stats (monitored count, active blocks, messages flagged/deleted, warnings sent, classifier errors, most-flagged categories) and a filterable, paginated explorer over every logged message, including anything already deleted, since the audit log is the only remaining record of it.
- **Policy** — the global moderation policy the classifier judges every message against. Starts as a placeholder ("flag nothing until this is replaced") — write a real one here before trusting this with a real contact.
- **Settings** — every classifier/warning/strike/buffer tuning knob, including shadow mode itself, grouped by area, saved on blur/toggle. Applies immediately.

### Auth model

Authenticated via Tailscale identity, not a password or shared secret — see [`docs/decisions.md`](docs/decisions.md#web-control-app-back-to-trusting-the-header-issue-29-twice-revisited) for the full reasoning. If `ALLOWED_TAILSCALE_LOGIN` isn't set, there's no auth at all: the app binds every network interface, and anyone who can reach the host on this port can open it — a warning banner on the page says so. This is the default so the app never refuses to start over a missing Tailscale login; see [Restricting access with Tailscale](#restricting-access-with-tailscale) to turn it on.

## Restricting access with Tailscale

Requires [Tailscale](https://tailscale.com) installed on the host. Edit `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      ALLOWED_TAILSCALE_LOGIN: you@example.com   # exactly what `tailscale status` reports for your own login
```

Then, with the app running:

```sh
sudo tailscale serve --bg 4756
```

Open `https://<tailscale-hostname>/` (the hostname is whatever `tailscale serve status` prints) from a device signed in as that login. A visit from anyone else gets a 403 on every request. `src/web/control-server.ts` binds to `127.0.0.1` only in this mode, on purpose — it's reachable *only* through `tailscale serve`'s local proxy hop. **This is deliberately single-factor**, accepted for a host where the operator is the only account with shell access to the machine — see [`docs/decisions.md`](docs/decisions.md#web-control-app-back-to-trusting-the-header-issue-29-twice-revisited) for what to do if that assumption doesn't hold for your setup (e.g. a shared or multi-user server).

## How it works

### Classifier

Uses a local [Ollama](https://ollama.com) model, bundled as a Compose service — no per-message API cost, runs entirely on the self-hosted machine. `llama3.2:3b` is the default (`docker compose exec ollama ollama pull llama3.2:3b`); change it in the Settings panel. It was chosen over the cheaper `llama3.2:1b` after the smaller model proved unreliable under JSON-schema-constrained output — see [`docs/decisions.md`](docs/decisions.md) for the comparison.

**Fails open**: any Ollama error, timeout, or malformed response returns `{ ok: false }` rather than a guessed verdict — the message is left alone, never deleted, warned, or struck.

### Warning messages

The reply sent alongside a delete (`src/classifier/warning-message.ts`) is generated per violation, not a fixed string: it names the actual category/reason the message was flagged for and tells the contact plainly that an automated moderation system is watching the chat and will block them if it continues. Same fail-open contract as the classifier — a static fallback message (configurable in Settings) is sent instead if generation fails.

### Moderation pipeline and block/unblock scheduler

Incoming messages from monitored contacts are debounced, classified, and — if flagged — deleted locally, answered with a warning, and recorded as a strike. A contact is blocked the first time their strike count reaches the strike threshold, then automatically unblocked after the configured duration (± jitter, to avoid a fixed, detectable cadence). Disabling a contact's **escalation** toggle skips only the block/unblock step — classification, delete-for-me, warnings, strikes, and the audit log all still run. Shadow mode skips all of the above and only logs. See [`docs/decisions.md`](docs/decisions.md#trigger-duration-and-jitter-issue-8-design) for the full design.

### Manual override routines

Every monitored contact can be paused, resumed, or unblocked ahead of schedule, independently of every other contact, driven by the web control app rather than WhatsApp chat commands — see [`docs/decisions.md`](docs/decisions.md#manual-override-channel-issue-9) for why. `pause`/`resume` stop/resume classifying and acting on incoming messages for that contact entirely (resets on restart); `unblock` unblocks immediately, ahead of the jittered schedule.

## Development

Requirements: Node.js 24+ (the backend runs TypeScript directly via Node's built-in stripping — no separate build step) and [Ollama](https://ollama.com), running locally, with a model pulled.

```sh
npm install
ollama pull llama3.2:3b
CONTROL_PORT=4756 npm start
```

`npm run typecheck` and `npm run lint` check the backend; `npm test` runs the full suite (pure logic + real SQLite, no WhatsApp, no Ollama — includes the manual override routines and the control app's HTTP/auth logic against a real server on an ephemeral port).

Sending real WhatsApp messages back and forth for every change is slow and, for block/unblock, requires a second WhatsApp account. Each layer can be exercised on its own instead:

- **Classifier** (Ollama only, no WhatsApp): `npm run classifier:test`
- **Buffer** (pure timers): `npm run buffer:test`
- **Store** (SQLite, no WhatsApp): `npm run store:test`
- **Moderation pipeline** (classifier + buffer + store, actions stubbed to console output): `npm run pipeline:test`
- **WhatsApp actions** (`sendWarning` + `deleteForMe` against a real connection, classifier/buffer/pipeline bypassed): `TARGET_CONTACT_JID=<a JID you can message, e.g. your own> npm run whatsapp:test-actions`
- **Block/unblock**: needs a real second WhatsApp account's JID (WhatsApp doesn't let you block your own account) — `BLOCK_TEST_JID=15551234567@s.whatsapp.net npm run prototype:block-unblock`. Check your phone directly too: `fetchBlocklist()` can return a stale snapshot for a few seconds right after a block/unblock call.

Only the full live pipeline (`npm start`) and block/unblock genuinely require a live WhatsApp round-trip; everything else runs offline or against a stub.

The first run needs a WhatsApp QR code scanned interactively; `index.ts` stores the resulting session in `auth_info/`, reused on later runs. `deleteForMe` (and any other app-state action) needs a sync key WhatsApp pushes to a companion device shortly after linking — give a **freshly** linked `auth_info/` a few minutes to sit open and idle before relying on it; `npm run prototype:delete-for-me` validates this in isolation (`TEST_ALLOW_SELF=1` to test against your own "Message yourself" chat, no second number needed). If `chatModify` throws `App state key not present!` well after linking, log out the device from WhatsApp → Linked Devices and relink cleanly.

### Frontend

A Vite + React + TypeScript app in [`web/`](web/), styled with [shadcn/ui](https://ui.shadcn.com/) on Tailwind CSS v4 — add a component with `npx shadcn@latest add <component>` from inside `web/`. `npm run dev` (repo root) runs the backend under `nodemon` and `vite build --watch` side by side; `control-server.ts` reads `web/dist/` fresh on every request, so a frontend change just needs a browser reload. `npm run build:web` does a one-off production build; `npm test` runs it automatically first.

### Building the container from source

```sh
git clone https://github.com/BSoDium/WhatsApp-content-moderation.git
cd WhatsApp-content-moderation
cp docker-compose.override.yml.example docker-compose.override.yml
docker compose up -d --build
```

Compose auto-merges `docker-compose.override.yml` whenever present — it builds a distinct `whatsapp-content-moderation:dev` tag from local source instead of pulling the published image, so it's never confused with a real release. Delete the override file to go back to the published image. `./scripts/update.sh --build` rebuilds and restarts the same way after a `git pull`; `./scripts/pair.sh` tails the app's log for the pairing QR code the same way the quick-start's `docker compose logs -f` command does, but returns control automatically once connected.

## Reference hardware

Designed to run comfortably on a mid-range machine — not as low as a Raspberry Pi, but not requiring a dedicated GPU or a high-end PC either. The reference target is a 2-core/8GB, GPU-less Celeron box (e.g. a Lenovo ThinkCentre 10MQ) chosen for low power/noise/heat as an always-on background server, not raw throughput — the classifier's 90-second default timeout and `llama3.2:3b` model choice both account for that CPU-only profile. See [`docs/decisions.md`](docs/decisions.md) for the full benchmark reasoning and sources if you're sizing different hardware.

## Architecture

- **Transport**: Baileys (no headless browser, lighter than whatsapp-web.js)
- **Classifier**: LLM call per message (structured JSON output, not free-text), with conversation context, fail-open on API errors
- **State**: SQLite — strike counts, block records, every setting (including the moderation policy), and a full audit log of messages + classifications (the only record once a message is deleted)
- **Scheduler**: periodic check for expired blocks, jittered rather than fixed-interval
- **Deployment**: self-hosted via Docker Compose, `restart: always`, `auth_info/`/`data/` on persisted + backed-up bind mounts, no other host state — see [`docs/decisions.md`](docs/decisions.md#dropping-env-configpolicymd-and-first-boot-file-imports)

## Further reading

- [`docs/decisions.md`](docs/decisions.md) — durable design rationale and the full history behind decisions summarized above.
- [`docs/roadmap.md`](docs/roadmap.md) — a one-time snapshot of the original build order, and the checklist for trusting this with a real contact.
- [`AGENTS.md`](AGENTS.md) — conventions for anyone (human or agent) contributing code to this repo.
