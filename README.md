# WhatsApp-content-moderation

A localised, background-hosted "digital curtain" for a personal WhatsApp account. It links to the account as a headless companion device (via [Baileys](https://github.com/WhiskeySockets/Baileys)), runs incoming messages from an operator-chosen set of monitored contacts through an LLM classifier, deletes flagged messages locally ("delete for me"), sends a warning, and temporarily blocks a contact after repeated strikes (unless that contact has escalation turned off).

## Status

**Pre-release.** The moderation pipeline, block/unblock scheduler, manual override routines, and the multi-contact web control app are all built and have been validated against real WhatsApp accounts — see [`docs/decisions.md`](docs/decisions.md) for how, and for the full design history. This has **not** been run against a real contact for real moderation yet: `config/policy.md` is still the placeholder template. Run with `SHADOW_MODE=1` (the default) and review its logs before pointing this at anyone — see [`docs/roadmap.md`](docs/roadmap.md) for the remaining checklist.

## Requirements

- Node.js 24+ (the backend runs TypeScript directly via Node's built-in stripping — no separate build step)
- [Ollama](https://ollama.com), running locally, with a model pulled
- A phone with WhatsApp, to scan a QR code the first time you link the account
- Optional, to use the web control app: [Tailscale](https://tailscale.com)

## Quick start

```sh
npm install
cp config/policy.example.md config/policy.md   # fill this in before real use — see "Classifier" below
ollama pull llama3.2:3b
WEB_CONTROL_PORT=4756 ALLOWED_TAILSCALE_LOGIN=you@example.com npm start
```

`npm run typecheck` and `npm run lint` check the backend before you start it.

The first run needs a WhatsApp QR code scanned interactively. `index.ts` stores the resulting session in `auth_info/`, so later runs reuse it without re-scanning. Once connected, open the web control app and add a contact to the monitored roster — every incoming message from a monitored contact is buffered, classified, and acted on (delete-for-me + warning + strike on a flag); everyone else is ignored. Leave `SHADOW_MODE=1` (classify and log without acting) until you've reviewed its behavior against real traffic.

No second WhatsApp number to test with? Set `TEST_ALLOW_SELF=1` and add your own JID to the roster instead — the same idea the prototypes below use. Your own "Message yourself" chat sometimes routes through the newer `@lid` JID form rather than your phone-number JID; if self-test messages never reach the pipeline, check the actual `remoteJid` Baileys reports (log it once from `messages.upsert`, or check the control app's contact picker) rather than assuming the phone-number form.

## Configuration

Copy `.env.example` to `.env` (or set these directly in the environment — see [Deployment](#debian-install-and-updates) for the guided Debian setup).

| Variable | Default | Purpose |
|---|---|---|
| `SHADOW_MODE` | `1` | Classify and log without deleting, warning, or blocking. |
| `WEB_CONTROL_PORT` | unset | Enables the [web control app](#web-control-app) on this port. This is also the only way to add a contact to the roster — leaving it unset means the moderator does nothing at all. |
| `ALLOWED_TAILSCALE_LOGIN` | unset | The one Tailscale login allowed to use the control app. Required if `WEB_CONTROL_PORT` is set; the process refuses to start otherwise. |
| `TEST_ALLOW_SELF` | `0` | Set to `1` to test the pipeline against messages you send yourself, with no second WhatsApp number. |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Where the classifier reaches Ollama. |
| `OLLAMA_MODEL` | `llama3.2:3b` | Classifier model — see [Classifier](#classifier) for why not the cheaper `1b`. |
| `CLASSIFIER_TIMEOUT_MS` | `90000` | Classifier request timeout, sized for CPU-only inference — see [Reference hardware](#reference-hardware). |
| `CLASSIFIER_HISTORY_LIMIT` | `10` | Prior messages included as conversation context. |
| `STRIKE_THRESHOLD` | `3` | Strikes before a contact is blocked. |
| `BLOCK_DURATION_MS` | `86400000` (24h) | Block length before auto-unblock. |
| `BLOCK_JITTER_MS` | `14400000` (±4h) | Randomization applied to the block duration — see [`docs/decisions.md`](docs/decisions.md#trigger-duration-and-jitter-issue-8-design) for why this matters. |
| `UNBLOCK_POLL_INTERVAL_MS` | `120000` (2min) | How often the scheduler checks for expired blocks. |
| `BUFFER_WINDOW_MS` | `7000` (7s) | Debounce window before classification. |
| `DB_PATH` | `data/moderation.sqlite` | SQLite database path. |
| `WARNING_MODEL` | `OLLAMA_MODEL` | Model used to generate a per-violation warning message — see [Warning messages](#warning-messages). |
| `WARNING_TIMEOUT_MS` | `90000` | Warning-generation request timeout. |
| `WARNING_TEMPERATURE` | `0.4` | 0 = deterministic, higher = more varied phrasing. |
| `WARNING_MAX_LENGTH` | `320` | Hard cap on the generated message's length, in characters. |
| `WARNING_MESSAGE` | `That message was removed for violating this chat's policy.` | Fallback text sent only if generating a warning message fails — see [Warning messages](#warning-messages). |

`TARGET_CONTACT_JID` and `BLOCK_TEST_JID` are not application configuration — they're arguments to the standalone test scripts below (`whatsapp:test-actions`, `prototype:block-unblock`). The live pipeline has no single-contact equivalent; contacts are managed entirely through the [web control app](#web-control-app)'s roster.

## How it works

### Classifier

Uses a local [Ollama](https://ollama.com) model — no per-message API cost, runs entirely on the self-hosted machine.

```sh
brew install ollama   # or see ollama.com for other platforms
ollama serve           # or `brew services start ollama`
ollama pull llama3.2:3b
```

The moderation policy — what actually gets flagged — is **not** in this repo. It's personal and describes a real contact, so it lives in `config/policy.md`, which is gitignored:

```sh
cp config/policy.example.md config/policy.md
```

Try it without a WhatsApp connection: `npm run classifier:test`.

- `llama3.2:1b` was tried first — the cheapest fit for the reference deployment target's 2-core/8GB, GPU-less profile (see [Reference hardware](#reference-hardware)) — but was unreliable: under JSON-schema-constrained output it would write a correct `category`/`reason` and then still set `flagged: false`, contradicting its own reasoning. `llama3.2:3b` got every hand-tested case right and stayed internally consistent, so it's the default (`OLLAMA_MODEL` to override).
- The response schema orders fields as `category`, `reason`, then `flagged` on purpose — this makes the model commit to its reasoning before the boolean verdict, instead of guessing `flagged` cold.
- **Fails open**: any Ollama error, timeout, or malformed response returns `{ ok: false }` rather than a guessed verdict. Callers must never delete/block on `ok: false`.

### Warning messages

The reply sent alongside a delete (`src/classifier/warning-message.ts`) is generated per violation, not a fixed string: it names the actual category/reason the message was flagged for and tells the contact plainly that an automated moderation system is watching the chat and will block them if it continues — this project deliberately doesn't hide that a system, not the account owner, is responding. Same fail-open contract as the classifier: any Ollama error, timeout, or empty response returns `{ ok: false }`, and `moderation-pipeline.ts` falls back to the static `WARNING_MESSAGE` so a warning is still sent either way. Configurable independently of the classifier's model/host — see [Configuration](#configuration).

### Moderation pipeline and block/unblock scheduler

Incoming messages from monitored contacts are debounced (`BUFFER_WINDOW_MS`), classified, and — if flagged — deleted locally, answered with a warning, and recorded as a strike. A contact is blocked the first time their strike count reaches `STRIKE_THRESHOLD`, then automatically unblocked after `BLOCK_DURATION_MS` ± `BLOCK_JITTER_MS`, checked every `UNBLOCK_POLL_INTERVAL_MS` by `src/pipeline/unblock-scheduler.ts`. Disabling a contact's **escalation** toggle (in the control app) skips only the block/unblock step — classification, delete-for-me, warnings, strikes, and the audit log all still run. `SHADOW_MODE` skips all of the above and only logs. See [`docs/decisions.md`](docs/decisions.md#trigger-duration-and-jitter-issue-8-design) for the full design, including why the block/unblock cycle is itself a ban-detection risk and how jitter mitigates it.

### Manual override routines

Every monitored contact can be paused, resumed, or unblocked ahead of schedule, independently of every other contact (`src/override/manual-override.ts`), driven by the [web control app](#web-control-app) rather than WhatsApp chat commands — see [`docs/decisions.md`](docs/decisions.md#manual-override-channel-issue-9) for why.

- `pause` / `resume` — stop/resume classifying and acting on incoming messages for that contact entirely (no audit-log entries while paused). Resets on restart.
- `unblock` — unblock that contact immediately, ahead of the jittered schedule.
- Status (pause state, strike count, block status) isn't a command — it's read directly via `getStatus(contactId)`, which the control app polls to render each contact's detail panel.

### Web control app

A small web app hosted by the same process (`src/web/`), authenticated via Tailscale identity rather than a password, OAuth login, or shared secret. On the page (`GET /`) and every `/api/*` route, the server checks the `Tailscale-User-Login` header that `tailscale serve` sets when proxying a request from the tailnet, against the single allow-listed `ALLOWED_TAILSCALE_LOGIN`. **This is deliberately single-factor**, accepted for a host where the operator is the only account with shell access to the machine: the loopback bind stops remote access, but any *local* process on the same host could still set that header directly. See [`docs/decisions.md`](docs/decisions.md#web-control-app-back-to-trusting-the-header-issue-29-twice-revisited) for the full reasoning, including two rejected alternatives, and what to do if that single-operator assumption doesn't hold for your setup (e.g. a shared or multi-user server). `GET /assets/*` (the built frontend's JS/CSS/font bundle) is the only unauthenticated route — none of it contains anything secret.

This is where contacts actually get moderated: a scrollable list shows every contact Baileys has learned about so far (a contact who's never messaged and isn't in your phone's synced address book will only show up as a bare number), searchable by name or number, each with a switch that directly turns moderation on/off. Clicking a contact (not the switch) opens a detail panel — strikes, block status, a pause switch, an escalation switch (turn off auto-blocking for a contact you can't afford to actually block — the rest of moderation still runs), an unblock button, and a "Message history" link into the activity panel below. Turning a contact's switch off only stops future moderation; its strike/block/audit history is kept. The page follows the OS/browser's light/dark preference automatically — there's no in-app toggle.

**Activity panel**: the "Activity" button in the header (or a contact's "Message history" row) opens a panel with roster-wide stats (monitored count, active blocks, messages flagged/deleted, warnings sent, classifier errors, most-flagged categories) and a filterable, paginated explorer over every logged message — including anything already deleted, since the audit log is the only remaining record of it. Filter by contact, by action (deleted/warned/passed/classifier error/action failed/shadow), or by message text; "Load more" pages further back via `GET /api/audit-log`'s cursor, `GET /api/stats` backs the numbers at the top.

**Enabling and running it:**

```sh
WEB_CONTROL_PORT=4756
ALLOWED_TAILSCALE_LOGIN=you@example.com   # exactly what `tailscale status` reports for your own login
```

```sh
tailscale serve --bg 4756
```

Then open `https://<tailscale-hostname>/` (the hostname is whatever `tailscale serve status` prints) from a device signed in as the allow-listed login. A visit from anyone else gets a 403 on every request. The server binds to `127.0.0.1` only, on purpose — it must be reachable *only* through `tailscale serve`'s local proxy hop, never directly.

**Developing the frontend**: the page is a Vite + React + TypeScript app in [`web/`](web/), styled with [shadcn/ui](https://ui.shadcn.com/) components on Tailwind CSS v4 — add a component with `npx shadcn@latest add <component>` from inside `web/`. `npm run dev` (repo root) runs the backend under `nodemon` (scoped to `src/` only) and `vite build --watch` side by side; `control-server.ts` reads `web/dist/` fresh on every request rather than caching it at startup, so a frontend change just needs a plain browser reload — no server restart. `npm run build:web` alone does a one-off production build; `npm test` runs it automatically first (`pretest`), since `control-server.test.ts` serves real files out of `web/dist/`.

## Development

Sending real WhatsApp messages back and forth for every change is slow and, for block/unblock, requires a second WhatsApp account you may not have. Each layer below can be exercised on its own instead:

- **Automated tests** (pure logic + real SQLite, no WhatsApp, no Ollama — assertions, real pass/fail, no manual reading required): `npm test` (includes the manual override routines and the web control app's HTTP/auth logic against a real server on an ephemeral port, with a synthetic `Tailscale-User-Login` header — not against a live `tailscale serve`, see [Web control app](#web-control-app))
- **Classifier** (Ollama only, no WhatsApp): `npm run classifier:test`
- **Buffer** (pure timers, no WhatsApp, no Ollama): `npm run buffer:test`
- **Store** (SQLite, no WhatsApp): `npm run store:test`
- **Moderation pipeline** (classifier + buffer + store, `deleteForMe`/`sendWarning` stubbed to console output): `npm run pipeline:test`
- **WhatsApp actions** (`sendWarning` + `deleteForMe` against a real connection, classifier/buffer/pipeline bypassed entirely): `TARGET_CONTACT_JID=<a JID you can message, e.g. your own> npm run whatsapp:test-actions` — sends a throwaway message and immediately deletes it, so no second number or friend's participation is needed just to confirm these two primitives still work. Needs an `auth_info/` link that's had a few minutes to settle after first pairing (see "Validating 'delete for me'" below); `App state key not present!` almost always means the app-state sync key hasn't arrived yet, not a bug in the call itself.
- **Block/unblock**: still needs a real second WhatsApp account's JID — see "Validating block/unblock" below. This is a WhatsApp-side restriction (you cannot block your own account), not something isolation can remove, but the second account only needs to exist, not actively participate.

Only the full live pipeline (`npm start`) and block/unblock genuinely require a live WhatsApp round-trip; everything else above runs offline or against a stub.

### Validating "delete for me"

This has to be run interactively on the machine you intend to self-host on, since it requires scanning a QR code with your phone.

```sh
npm install
npm run prototype:delete-for-me
```

Then, from a second WhatsApp account, send a text message to the linked account. The script waits a few seconds, calls `chatModify({ deleteForMe: ... })`, and logs the result — check your phone to confirm the message actually disappeared.

No second number on hand? Set `TEST_ALLOW_SELF=1` to test against messages you send yourself instead (e.g. the "Message yourself" chat) — the `deleteForMe` mechanism doesn't care who sent the message, so this still exercises the thing being validated.

`deleteForMe` (and any other `chatModify` app-state action — archive, pin, etc.) needs an app-state sync key that WhatsApp pushes to a companion device shortly after it's linked. On a **freshly** linked `auth_info/`, give the connection a few minutes to sit open and idle before relying on `deleteForMe` — restarting the process repeatedly right after linking can interrupt that handshake and leave it missing indefinitely. If `chatModify` throws `App state key not present!` well after linking, log out the device from WhatsApp → Linked Devices and relink cleanly rather than retrying in place.

### Validating block/unblock

Same interactive requirement as above, plus a real second WhatsApp number: you can't block your own "Message yourself" chat, so there's no self-test fallback here.

```sh
npm install
BLOCK_TEST_JID=15551234567@s.whatsapp.net npm run prototype:block-unblock
```

The script blocks the target via `updateBlockStatus`, confirms it with `fetchBlocklist()`, waits a few seconds, then unblocks and confirms again. Check your phone directly too: does the contact actually show as blocked, then unblocked?

`fetchBlocklist()` can return a stale snapshot for a few seconds right after a socket connects or right after a block/unblock call — a fresh `updateBlockStatus` call may not show up in the very next `fetchBlocklist()` even though it already took effect (confirmed via the phone's own "You blocked/unblocked this person" system messages, which are the reliable signal). The script retries a few times before reporting either step as failed; if it still can't confirm after that, trust the phone over the console.

## Reference hardware

This is designed to run comfortably on a mid-range machine — not as low as a Raspberry Pi, but not requiring a dedicated GPU or a high-end PC either. Two machines were considered as the actual self-host target:

| | Lenovo ThinkCentre (10MQ, S0KM00) | Dell OptiPlex 3050 |
|---|---|---|
| CPU | Intel Celeron G3930T, 2.70 GHz | Intel Core i5-7500, up to 3.40 GHz |
| RAM | 8 GB | 16 GB |
| GPU | Intel HD Graphics 610 | — |
| Power/noise/heat | Low | Higher |

**The ThinkCentre is the default target**, even though the OptiPlex is clearly more capable: it runs as an always-on background server in a lived-in space, where lower power draw, noise, and heat output matter more day to day than raw throughput. The OptiPlex is the fallback if the ThinkCentre's throughput genuinely becomes a bottleneck — swap machines, not architecture, if that ever happens.

The classifier's model choice (see [Classifier](#classifier)) was picked with the ThinkCentre's CPU-only, 2-core/8GB profile in mind, but hasn't actually been benchmarked on that hardware yet — only functionally verified on a much faster dev machine. Two things stack against it there: the Celeron G3930T (Kaby Lake, 2017) has no AVX2, which `llama.cpp`/Ollama's CPU kernels lean on heavily; and only 2 cores/threads, well short of the ~5 threads research suggests are needed to saturate typical dual-channel DDR4 bandwidth. Rough anchor points from public CPU-only `llama3.2:3b` benchmarks (a Raspberry Pi 5 gets ~4.6–4.9 tok/s, an Intel N150 gets ~9 tok/s) put **a rough estimate at 1–3 tok/s** for this hardware — call it 15–45 seconds for the classifier's short JSON response. That's too slow for a live chat reply, but the moderation pipeline doesn't need one; it only gates a delete/warn/block decision that already tolerates some delay. A multi-minute wait would still be a problem — that's the threshold to check for once this actually runs on the ThinkCentre. If it turns out too slow in practice: populate the second SO-DIMM slot for dual-channel memory before dropping to a smaller/less reliable model (`llama3.2:1b` was already tried and rejected for correctness, not speed).

Sources: [Celeron G3930T spec (Intel)](https://www.intel.com/content/www/us/en/products/sku/97467/intel-celeron-processor-g3930t-2m-cache-2-70-ghz/specifications.html), [Pentium/Celeron AVX2 segmentation (TechPowerUp)](https://www.techpowerup.com/273516/intel-tiger-lake-based-pentium-and-celeron-to-feature-avx2-an-instruction-the-entry-level-brands-were-deprived-of), [llama3.2:3b CPU benchmarks (geerlingguy/ai-benchmarks)](https://github.com/geerlingguy/ai-benchmarks/blob/main/README.md), [CPU inference memory-bandwidth notes (Puget Systems)](https://www.pugetsystems.com/labs/articles/effects-of-cpu-speed-on-gpu-inference-in-llama-cpp/), [ThinkCentre M710q Tiny (10MQ) memory config (memory.net)](https://memory.net/product-category/lenovo/thinkcentre/m710q-10mq/).

## Architecture

- **Transport**: Baileys (no headless browser, lighter than whatsapp-web.js)
- **Classifier**: LLM call per message (structured JSON output, not free-text), with conversation context, fail-open on API errors
- **State**: SQLite — strike counts, block records with `unblockAt`, full audit log of messages + classifications (the only record once a message is deleted)
- **Scheduler**: periodic check for expired blocks, jittered rather than fixed-interval
- **Deployment**: self-hosted on the reference hardware above, Docker with `restart: always`, auth state on a persisted + backed-up volume

## Debian install and updates

On a Debian x86-64 host with Docker Compose and Tailscale installed:

```sh
git clone https://github.com/BSoDium/WhatsApp-content-moderation.git
cd WhatsApp-content-moderation
./scripts/setup.sh
```

`setup.sh` creates `.env` and `config/policy.md`, fixes directory ownership for the container, and prints the exact commands to run next. It's safe to re-run. **If it warns that `ALLOWED_TAILSCALE_LOGIN` is still unset, fix that first** — the app refuses to start without it, and will crash-loop under Docker's restart policy rather than just failing once. Then, following what it prints:

```sh
docker compose up -d --build
docker compose exec ollama ollama pull llama3.2:3b
docker compose logs -f app        # scan the QR code shown here
./scripts/preflight.sh            # sanity-check before going live
sudo tailscale serve --bg 4756
```

Edit `config/policy.md` before connecting a real account, and leave `SHADOW_MODE=1` (the default) until you've reviewed its logs against real traffic. Then open the control app at the URL from `sudo tailscale serve status`.

To update later:

```sh
./scripts/update.sh
```

<details>
<summary><strong>What <code>setup.sh</code> does, and how to do it by hand</strong></summary>

This recipe clones and builds the source. Tagged GitHub releases also publish `ghcr.io/bsodium/whatsapp-content-moderation`, but this Compose setup does not pull that image.

[`scripts/setup.sh`](scripts/setup.sh) does the tedious, error-prone part of first-time setup for you, and never overwrites a value you've already set:

- copies `.env.example` → `.env` and `config/policy.example.md` → `config/policy.md` if they don't already exist
- creates `auth_info/` and `data/`, and chowns those plus `config/policy.md` to UID 1000 (the container's user) via `sudo`, prompting for it only if needed
- sets `WEB_CONTROL_PORT=4756`
- if `jq` is installed and this host isn't Tailscale-tagged, auto-detects its Tailscale login (via `tailscale status --json`) and fills in `ALLOWED_TAILSCALE_LOGIN` — this assumes a single-user tailnet, where the host and the device you'll open the control app from belong to the same Tailscale account; double-check the value it picks. On a Tailscale-tagged host (e.g. `tag:server`, the recommended setup for an always-on server) this deliberately does nothing instead of guessing, since a tagged node's own identity is a machine name, not the operator's login — set `ALLOWED_TAILSCALE_LOGIN` yourself in that case

It won't write your moderation policy for you. Keep `.env`, `config/policy.md`, `auth_info/`, and `data/` private and back up the session and database.

If you'd rather do it by hand (or the script can't run on your setup):

```sh
cp .env.example .env
cp config/policy.example.md config/policy.md
mkdir -p auth_info data
chmod 600 .env config/policy.md
chmod 700 auth_info data
sudo chown -R 1000:1000 auth_info data config/policy.md
```

The container runs as UID 1000. If your Debian login has a different UID, use `sudoedit config/policy.md` to edit the private, container-owned policy.

Edit `.env`: set `WEB_CONTROL_PORT=4756` and your exact Tailscale login in `ALLOWED_TAILSCALE_LOGIN` (run `tailscale status` and use exactly what it reports for your account).

</details>

<details>
<summary><strong>Scanning the QR code and running <code>preflight.sh</code></strong></summary>

Scan the QR shown by `docker compose logs -f app` from WhatsApp → Linked devices. Then run [`scripts/preflight.sh`](scripts/preflight.sh) — it checks Compose, the pulled model, bind-mount ownership, the control port, and `tailscale serve` in one pass, including whether this host's Tailscale login matches `ALLOWED_TAILSCALE_LOGIN` (a mismatch there is the most common cause of a 403 from the control app). Fix anything it flags, then open the URL from `sudo tailscale serve status` — no query param needed. `preflight.sh`'s login check is only a same-host heuristic, not a substitute for the real test: confirm the page actually works from your allowed Tailscale login and is rejected from a different login or device — see [Web control app](#web-control-app). Add a contact in the control app and review shadow-mode logs before setting `SHADOW_MODE=0`.

The app uses host networking so its loopback-only control server is the same `127.0.0.1` that host Tailscale proxies. Ollama stays in Compose and is published on host loopback only.

</details>

<details>
<summary><strong>What <code>update.sh</code> does</strong></summary>

[`scripts/update.sh`](scripts/update.sh) refuses to run if you have local tracked changes (commit or stash them first), otherwise it runs `git pull --ff-only` followed by `docker compose up -d --build app`, then flags any settings `.env.example` gained since your last update that aren't in your `.env` yet. Your `.env`, policy, WhatsApp session, SQLite data, and downloaded model persist across app rebuilds. Back them up before host maintenance.

</details>

## Further reading

- [`docs/decisions.md`](docs/decisions.md) — durable design rationale and the full history behind decisions summarized above.
- [`docs/roadmap.md`](docs/roadmap.md) — a one-time snapshot of the original build order, and the checklist for trusting this with a real contact.
- [`AGENTS.md`](AGENTS.md) — conventions for anyone (human or agent) contributing code to this repo.
