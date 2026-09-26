# WhatsApp-content-moderation

A localised, background-hosted "digital curtain" for a personal WhatsApp account. It links to the account as a headless companion device (via [Baileys](https://github.com/WhiskeySockets/Baileys)), runs incoming messages from an operator-chosen set of monitored contacts through an LLM classifier, deletes flagged messages locally ("delete for me"), sends a warning, and temporarily blocks a contact after repeated strikes (unless that contact has escalation turned off).

## Status

**`deleteForMe` validated (2026-09-24).** Linked a real WhatsApp account as a
companion device via the prototype below and confirmed that Baileys'
`chatModify({ deleteForMe: ... })` app-state patch actually removes a message
from the primary phone — the one assumption the whole "digital curtain"
premise depended on. (Ran with `TEST_ALLOW_SELF=1` against a "Message
yourself" chat, since no second WhatsApp number was available at the time —
see the note on that flag below.)

**Classifier module built (2026-09-24).** Ollama-backed, structured JSON
output, fail-open. See "Classifier" below.

**Live pipeline wired up (2026-09-26).** `deleteForMe`, `sendWarning`, and
block/unblock all confirmed working end-to-end against real WhatsApp
accounts (see "Validating..." sections below), and `index.ts` wires
strike → warn → delete into a live connection.

**Block/unblock scheduler built and validated (2026-09-26).** Issue #8:
strikes crossing `STRIKE_THRESHOLD` trigger a block, `src/pipeline/
unblock-scheduler.js` polls and auto-unblocks once the jittered duration
passes — see "Block/unblock scheduler" below and
[`docs/decisions.md`](docs/decisions.md) for the design. Confirmed live in
two parts: self-chat (strike/delete/warn, plus the block attempt correctly
failing against your own account — WhatsApp doesn't allow self-blocking)
and a real second account (block and scheduled auto-unblock both fired for
real, no manual step). A self-review afterward caught and fixed a real
crash risk (an uncaught DB error in the scheduler's poll loop could have
taken down the whole process) and a case where a successful block with a
failed local write would leave a contact blocked with no record to ever
auto-unblock — see the PR #21 history for detail, not repeated here.

**Manual override + web control app built (2026-09-26).** Issue #9's
pause/status/unblock routines (`src/override/manual-override.ts`) are
driven by issue #29's Tailscale-authenticated web app (`src/web/`), not
WhatsApp chat commands — see "Manual override routines" and "Web control
app" below.

**Control-app auth redesigned around LocalAPI WhoIs, no shared token
(2026-09-27).** The original header+token design worked once confirmed live
(see [`docs/decisions.md`](docs/decisions.md#web-control-app-tailscale-identity-headers-issue-29)),
but the mandatory first-visit `?token=...` step was confusing enough in
practice to redesign: the control app now asks `tailscaled`'s own local API
who owns each connection instead of trusting a proxy header, so there's no
token to generate, paste, or bootstrap — see "Web control app" below and
[`docs/decisions.md`](docs/decisions.md#web-control-app-replacing-the-headertoken-with-localapi-whois-issue-29-revisited).
**Not yet validated against a live `tailscale serve` + `tailscaled`** — see
"Web control app"'s own callout.

**Multi-contact roster + redesigned control app built (2026-09-26).** Issue
#32: `TARGET_CONTACT_JID` is gone — moderated contacts are now an
operator-managed roster with a per-contact escalation toggle, added/removed
through the control app's contact picker and tabs. See "Web control app"
below and [`docs/decisions.md`](docs/decisions.md#multi-contact-moderation-roster-issue-32).

**Not yet ready to run against a real contact.** `config/policy.md` is
still the example placeholder — see docs/roadmap.md "Before trusting this
with a real contact" for the remaining checklist (real policy, shadow-mode
run first, etc.) before pointing this at anyone for real.

Remaining roadmap: [`docs/roadmap.md`](docs/roadmap.md).

## Running it

Not yet run against a real account — see issue #15. Requires `config/policy.md` filled in (see "Classifier" below), Ollama running, and the [web control app](#web-control-app) enabled — moderated contacts are chosen entirely through its picker now, there's no env var to set here:

```
npm install
WEB_CONTROL_PORT=4756 ALLOWED_TAILSCALE_LOGIN=you@example.com npm start
```

The backend uses Node 24's built-in TypeScript stripping at runtime. Run
`npm run typecheck` and `npm run lint` to check the backend before starting it.

First run needs the QR code scanned interactively, same as the prototypes below — `index.ts` reuses `auth_info/`, so it picks up an existing link from `prototype:delete-for-me` if you've already run that. Once connected, open the control app and add a contact to the monitored-contacts roster — every incoming message from a monitored contact gets buffered, classified, and acted on for real (delete-for-me + warning + strike on a flag); everyone else is ignored. `SHADOW_MODE=1` classifies and logs without acting, for watching it against real traffic first.

No second number handy? Set `TEST_ALLOW_SELF=1` and add your own JID to the roster instead — same idea as `prototype:delete-for-me`'s flag of the same name — to validate the live pipeline against messages you send yourself.

Your own "Message yourself" chat isn't always addressed by your phone-number JID — some accounts route it through the newer `@lid` form instead (e.g. `110599736393979@lid`). If messages you send yourself never reach the pipeline under `TEST_ALLOW_SELF`, check the actual `remoteJid` Baileys reports (log it once from `messages.upsert`, or check the control app's contact picker) rather than assuming the phone-number form.

## Testing each layer in isolation

Sending real WhatsApp messages back and forth for every change is slow and, for block/unblock, requires a second WhatsApp account you may not have. Each layer below can be exercised on its own instead:

- **Automated tests** (pure logic + real SQLite, no WhatsApp, no Ollama — assertions, real pass/fail, no manual reading required): `npm test` (includes the manual override routines and the web control app's HTTP/auth logic against a real server on an ephemeral port, with a fake stand-in for `tailscaled`'s local API — not against a live `tailscale serve`/`tailscaled`, see "Web control app")
- **Classifier** (Ollama only, no WhatsApp): `npm run classifier:test`
- **Buffer** (pure timers, no WhatsApp, no Ollama): `npm run buffer:test`
- **Store** (SQLite, no WhatsApp): `npm run store:test`
- **Moderation pipeline** (classifier + buffer + store, `deleteForMe`/`sendWarning` stubbed to console output): `npm run pipeline:test`
- **WhatsApp actions** (`sendWarning` + `deleteForMe` against a real connection, classifier/buffer/pipeline bypassed entirely): `TARGET_CONTACT_JID=<a JID you can message, e.g. your own> npm run whatsapp:test-actions` — sends a throwaway message and immediately deletes it, so no second number or friend's participation is needed just to confirm these two primitives still work. Needs an `auth_info/` link that's had a few minutes to settle after first pairing (see the note under "Validating 'delete for me'" below); `App state key not present!` almost always means the app-state sync key hasn't arrived yet, not a bug in the call itself.
- **Block/unblock**: still needs a real second WhatsApp account's JID — see "Validating block/unblock" below. This is a WhatsApp-side restriction (you cannot block your own account), not something isolation can remove, but the second account only needs to exist, not actively participate.

Only the full live pipeline (`npm start`) and block/unblock genuinely require a live WhatsApp round-trip; everything else above runs offline or against a stub.

## Validating "delete for me"

This has to be run interactively on the machine you intend to self-host on, since it requires scanning a QR code with your phone.

```
npm install
npm run prototype:delete-for-me
```

Then, from a second WhatsApp account, send a text message to the linked account. The script waits a few seconds, calls `chatModify({ deleteForMe: ... })`, and logs the result — check your phone to confirm the message actually disappeared.

No second number on hand? Set `TEST_ALLOW_SELF=1` to test against messages
you send yourself instead (e.g. the "Message yourself" chat) — the
`deleteForMe` mechanism doesn't care who sent the message, so this still
exercises the thing being validated.

`deleteForMe` (and any other `chatModify` app-state action — archive, pin,
etc.) needs an app-state sync key that WhatsApp pushes to a companion
device shortly after it's linked. On a **freshly** linked `auth_info/`,
give the connection a few minutes to sit open and idle before relying on
`deleteForMe` — restarting the process repeatedly right after linking can
interrupt that handshake and leave it missing indefinitely. If `chatModify`
throws `App state key not present!` well after linking, log out the device
from WhatsApp → Linked Devices and relink cleanly rather than retrying in
place.

## Validating block/unblock

Confirmed working against a real second WhatsApp account — see issue #16.
Same interactive requirement as above, plus a real second WhatsApp number:
you can't block your own "Message yourself" chat, so there's no self-test
fallback here.

```
npm install
BLOCK_TEST_JID=15551234567@s.whatsapp.net npm run prototype:block-unblock
```

The script blocks the target via `updateBlockStatus`, confirms it with
`fetchBlocklist()`, waits a few seconds, then unblocks and confirms again.
Check your phone directly too: does the contact actually show as blocked,
then unblocked? This needs to pass before #8 builds a scheduler on top of
it.

`fetchBlocklist()` can return a stale snapshot for a few seconds right
after a socket connects or right after a block/unblock call — a fresh
`updateBlockStatus` call may not show up in the very next `fetchBlocklist()`
even though it already took effect (confirmed via the phone's own "You
blocked/unblocked this person" system messages, which are the reliable
signal). The script retries a few times before reporting either step as
failed; if it still can't confirm after that, trust the phone over the
console.

## Block/unblock scheduler

Wired into the live pipeline (`npm start`) — see
[`docs/decisions.md`](docs/decisions.md#trigger-duration-and-jitter-issue-8-design)
for the full design. A contact gets blocked the first time their strike
count reaches `STRIKE_THRESHOLD` (default **3**), and unblocked
automatically after `BLOCK_DURATION_MS` (default **24h**) ± `BLOCK_JITTER_MS`
(default **4h**), checked every `UNBLOCK_POLL_INTERVAL_MS` (default
**2 min**). All four are overridable via environment variable. `SHADOW_MODE`
skips blocking along with everything else it already skips.

## Manual override routines

Issue #9 originally proposed driving this via `!pause`/`!unblock`/`!status`
commands sent from your own "Message yourself" chat. That's not how this
ends up working — [see the issue's own follow-up
comment](https://github.com/BSoDium/WhatsApp-content-moderation/issues/9#issuecomment-5833459230):
a WhatsApp chat command is too primitive a control surface (no room for
things like rate limiting, no real visibility). The routines themselves
(`src/override/manual-override.ts`) are driven instead by the web control
app below.

Every routine is per-contact (issue #32) — pausing or unblocking one
monitored contact never affects another:

- `pause` / `resume` — stop/resume classifying and actioning incoming
  messages for that contact entirely (no audit-log entries either while
  paused). Resets on restart.
- `unblock` — unblock that contact immediately, ahead of the jittered
  schedule.
- Status (pause state, strike count, block status) isn't a command — it's
  read directly via `getStatus(contactId)`, which the control app polls to
  render each contact's tab.

## Web control app

Issues #29 and #32. A small web app hosted by the same process
(`src/web/`), authenticated via Tailscale identity rather than any
password/OAuth login or shared secret — see
[`docs/decisions.md`](docs/decisions.md#web-control-app-replacing-the-headertoken-with-localapi-whois-issue-29-revisited)
for the full reasoning. On the page (`GET /`) and every `/api/*` route, the
server asks `tailscaled`'s own local API (`GET
/localapi/v0/whois?addr=...`) who actually owns the TCP connection the
request arrived on, and checks that identity's login against a single
allow-listed login — the same thing `tailscale whois` prints, just called
over HTTP instead of the CLI. When `tailscale serve` proxies a real tailnet
request to this app, `tailscaled` itself opens the backend connection and
knows which tailnet peer it belongs to; a local process on this host
connecting to the port directly (the thing a shared secret used to guard
against) gets its own connection `tailscaled` has no record of, so the
lookup fails closed. There's nothing to generate, paste, or store — a plain
visit to the tailnet URL just works, every time, for the allow-listed login
only. `GET /assets/*` (the built frontend's JS/CSS/font bundle) is the only
unauthenticated route — none of it contains anything secret — see
[`docs/decisions.md`](docs/decisions.md#control-page-styling-three-files-two-of-them-unauthenticated).

This is where contacts actually get moderated: a scrollable list shows
every contact Baileys has learned about so far (a contact who's never
messaged and isn't in your phone's synced address book will only show up
as a bare number), searchable by name or number, each with a switch that
directly turns moderation on/off. Clicking a contact (not the switch) opens
a detail panel — strikes, block status, a pause switch, an escalation
switch (turn off auto-blocking for a contact you can't afford to actually
block — the rest of moderation still runs), and an unblock button. Turning
a contact's switch off only stops future moderation — its strike/block/
audit history is kept.

**Enabling it** (`.env` or environment):

```
WEB_CONTROL_PORT=4756
ALLOWED_TAILSCALE_LOGIN=you@example.com   # exactly what `tailscale status` reports for your own login
#TAILSCALED_SOCKET=/var/run/tailscale/tailscaled.sock   # default; override only for a non-default tailscaled --socket
```

The process refuses to start if `WEB_CONTROL_PORT` is set without
`ALLOWED_TAILSCALE_LOGIN` — fail closed rather than run unauthenticated or
with a mistyped port silently disabling the whole thing. The server binds
to `127.0.0.1` only, on purpose: it must be reachable *only* through
`tailscale serve`'s local proxy hop, never directly. Docker Compose also
needs `tailscaled`'s Unix socket bind-mounted into the container (already
in `docker-compose.yml`) — the LocalAPI call happens over that socket, not
the network.

**Running it**, on the same machine:

```
tailscale serve --bg 4756
```

Then open `https://<tailscale-hostname>/` (the hostname is whatever
`tailscale serve status` prints) from a device signed in as the
allow-listed login — no query param, no first-visit special case. A visit
from anyone else gets a 403 on every request, not just the first one.

**Developing the frontend**: the page is a Vite + React + TypeScript app in
[`web/`](web/), styled with [shadcn/ui](https://ui.shadcn.com/) components
on Tailwind CSS v4 — add a component with `npx shadcn@latest add
<component>` from inside `web/`. `npm run dev` (repo root) runs the backend
under `nodemon` (scoped to `src/` only — see `docs/decisions.md`'s "`npm run
dev`" note for why this is `nodemon` and not Node's own `--watch`) and `vite
build --watch` side by side; `control-server.js` reads `web/dist/` fresh on
every request rather than caching it at startup, so a frontend change just
needs a plain browser reload — no server restart, and no risk of hitting
the backend mid-rebuild (see `docs/decisions.md`'s "Control page styling"
for why an earlier version restarted the server on every frontend change,
and why that was a real bug, not a feature). `npm run build:web` alone does
a one-off production build; `npm test` runs it automatically first
(`pretest`), since `control-server.test.js` serves real files out of
`web/dist/`.

**Not yet validated against a live `tailscale serve` + `tailscaled`.**
Automated tests (`src/web/control-server.test.ts`,
`src/web/tailscale-whois-auth.test.ts`) cover the HTTP/auth logic against a
fake stand-in for `tailscaled`'s local API, but not that a real `tailscaled`
resolves a `tailscale serve`-proxied connection's ephemeral loopback port
the way this relies on, or that this host's socket permissions actually let
the container's UID reach `/var/run/tailscale/tailscaled.sock` — see
`docs/decisions.md`'s "replacing the header+token with LocalAPI WhoIs" for
exactly what to check before relying on this. Before trusting this: confirm
the socket is reachable, then open the page from the allow-listed device and
confirm it works, then from a different tailnet device/login and confirm
you're rejected. A request from any device that isn't on the tailnet
shouldn't even reach the port at all, since it's bound to loopback.

## Classifier

Uses a local [Ollama](https://ollama.com) model — no per-message API cost,
runs entirely on the self-hosted machine. Requires Ollama running locally
and the model pulled:

```
brew install ollama   # or see ollama.com for other platforms
ollama serve           # or `brew services start ollama`
ollama pull llama3.2:3b
```

The moderation policy — what actually gets flagged — is **not** in this
repo. It's personal and describes a real contact, so it lives in
`config/policy.md`, which is gitignored. Copy the template and fill it in:

```
cp config/policy.example.md config/policy.md
```

Try it without a WhatsApp connection:

```
npm run classifier:test
```

Notes from building this:

- `llama3.2:1b` was tried first — cheapest fit for the reference deployment
  target's 2-core/8GB, GPU-less profile (see "Reference hardware" below) —
  but was unreliable: under JSON-schema-constrained output it would write a
  correct `category`/`reason` (e.g. "insult" / "contains threats directed at
  me") and then still set `flagged: false`, contradicting its own reasoning.
  `llama3.2:3b` got every hand-tested case right and stayed internally
  consistent, so it's the default (`OLLAMA_MODEL` to override) — worth
  re-verifying carefully with `classifier:test` before dropping back to 1b.
- The response schema orders fields as `category`, `reason`, then `flagged`
  on purpose — this makes the model commit to its reasoning before the
  boolean verdict, instead of guessing `flagged` cold.
- Fails open: any Ollama error, timeout, or malformed response returns
  `{ ok: false }` rather than a guessed verdict. Callers must never
  delete/block on `ok: false`.

## Reference hardware

This is designed to run comfortably on a mid-range machine — not as low as
a Raspberry Pi, but not requiring a dedicated GPU or a high-end PC either.
Two machines were considered as the actual self-host target:

| | Lenovo ThinkCentre (10MQ, S0KM00) | Dell OptiPlex 3050 |
|---|---|---|
| CPU | Intel Celeron G3930T, 2.70 GHz | Intel Core i5-7500, up to 3.40 GHz |
| RAM | 8 GB | 16 GB |
| GPU | Intel HD Graphics 610 | — |
| Power/noise/heat | Low | Higher |

**The ThinkCentre is the default target**, even though the OptiPlex is
clearly more capable. This machine runs as an always-on background server
in a lived-in space, and its lower power draw, lower noise, and lower heat
output matter more day to day than raw throughput — the OptiPlex stays
available as a fallback for anything that turns out to need more headroom.

Concretely: **build and optimize for the ThinkCentre now** — it's the
machine this actually needs to run well on day to day, so that's what
correctness and performance work should target. The OptiPlex is the planned
upgrade path if the ThinkCentre's throughput genuinely becomes a bottleneck
(see the latency estimate below) rather than the default answer to it —
swap machines, not architecture, if that ever happens.

The classifier's model choice (see above) was picked with the ThinkCentre's
CPU-only, 2-core/8GB profile in mind, but hasn't actually been run on that
hardware yet — only functionally verified on a much faster dev machine.

### Estimated classifier latency on the ThinkCentre

Not yet benchmarked directly, but worth sizing up front rather than finding
out after deployment. Two things stack against it:

- The Celeron G3930T (Kaby Lake, 2017) has no AVX2 — Intel restricted AVX2
  to Core/Xeon on this generation, only bringing it to Celeron/Pentium
  starting with Tiger Lake years later. `llama.cpp`/Ollama's CPU kernels
  lean heavily on AVX2, so this CPU falls back to a slower code path.
- Only 2 cores/threads, and CPU token generation is largely memory-bandwidth
  bound (research suggests ~5 threads is enough to saturate typical
  dual-channel DDR4) — so 2 cores caps throughput well before bandwidth
  would. The ThinkCentre M710q Tiny (10MQ) has 2 SO-DIMM slots; if its 8GB
  is a single stick rather than 2×4GB, it's running single-channel, which
  would cap available bandwidth even further.

Rough anchor points from public CPU-only `llama3.2:3b` benchmarks: a
Raspberry Pi 5 (4 ARM cores, ~2.4GHz, no AVX equivalent) gets ~4.6–4.9
tok/s; an Intel N150 (4 modern cores with AVX2, faster RAM) gets ~9 tok/s.
The ThinkCentre has fewer cores than either and no AVX2, so **a rough
estimate is 1–3 tok/s for response generation** — call it 15–45 seconds for
the classifier's short JSON response, plus some seconds of prompt
processing for the policy text and conversation history. That's too slow
for a live chat reply, but the moderation pipeline doesn't need one: it
only gates a delete/warn/block decision that already tolerates some delay
(see `DELETE_DELAY_MS` in the prototype). A multi-minute wait would still
be a problem — that's the threshold to actually check for once this runs on
the real machine.

If it turns out too slow in practice: populate the second SO-DIMM slot for
dual-channel memory before dropping to a smaller/less reliable model —
`llama3.2:1b` was already tried and rejected for correctness, not speed
(see "Classifier" above).

Sources: [Celeron G3930T spec (Intel)](https://www.intel.com/content/www/us/en/products/sku/97467/intel-celeron-processor-g3930t-2m-cache-2-70-ghz/specifications.html), [Pentium/Celeron AVX2 segmentation (TechPowerUp)](https://www.techpowerup.com/273516/intel-tiger-lake-based-pentium-and-celeron-to-feature-avx2-an-instruction-the-entry-level-brands-were-deprived-of), [llama3.2:3b CPU benchmarks (geerlingguy/ai-benchmarks)](https://github.com/geerlingguy/ai-benchmarks/blob/main/README.md), [CPU inference memory-bandwidth notes (Puget Systems)](https://www.pugetsystems.com/labs/articles/effects-of-cpu-speed-on-gpu-inference-in-llama-cpp/), [ThinkCentre M710q Tiny (10MQ) memory config (memory.net)](https://memory.net/product-category/lenovo/thinkcentre/m710q-10mq/).

## Planned architecture

- **Transport**: Baileys (no headless browser, lighter than whatsapp-web.js)
- **Classifier**: LLM call per message (structured JSON output, not free-text), with conversation context, fail-open on API errors
- **State**: SQLite — strike counts, block records with `unblockAt`, full audit log of messages + classifications (the only record once a message is deleted)
- **Scheduler**: periodic check for expired blocks, jittered rather than fixed-interval
- **Deployment**: self-hosted on the reference hardware above, Docker with `restart: always`, auth state on a persisted + backed-up volume

## Debian install and updates

On a Debian x86-64 host with Docker Compose and Tailscale installed:

This recipe clones and builds the source. Tagged GitHub releases also
publish `ghcr.io/bsodium/whatsapp-content-moderation`, but this Compose
setup does not pull that image.

```sh
git clone https://github.com/BSoDium/WhatsApp-content-moderation.git
cd WhatsApp-content-moderation
cp .env.example .env
cp config/policy.example.md config/policy.md
mkdir -p auth_info data
chmod 600 .env config/policy.md
chmod 700 auth_info data
sudo chown -R 1000:1000 auth_info data config/policy.md
```

The container runs as UID 1000. If your Debian login has a different UID,
use `sudoedit config/policy.md` to edit the private, container-owned policy.

Edit `.env`: set `WEB_CONTROL_PORT=4756` and your exact Tailscale login in
`ALLOWED_TAILSCALE_LOGIN`. `SHADOW_MODE` defaults to `1`; leave it enabled
until you have reviewed the results. Write your own
moderation rules in `config/policy.md` before connecting a real account.
Keep `.env`, `config/policy.md`, `auth_info/`, and `data/` private and
back up the session and database.

The control app identifies you via `tailscaled`'s local API instead of a
token, over its Unix socket — already bind-mounted in
`docker-compose.yml`, but the socket's host permissions must let UID 1000
connect. Check this before relying on it:

```sh
ls -l /var/run/tailscale/tailscaled.sock
curl --unix-socket /var/run/tailscale/tailscaled.sock \
  'http://local-tailscaled.sock/localapi/v0/whois?addr=127.0.0.1:1'
```

A permission/connection error (not just a "no such connection" response,
which is expected for the bogus port above) means UID 1000 can't reach the
socket yet — see
[`docs/decisions.md`](docs/decisions.md#web-control-app-replacing-the-headertoken-with-localapi-whois-issue-29-revisited)
for what to try next before starting the app.

```sh
docker compose up -d --build
docker compose exec ollama ollama pull llama3.2:3b
docker compose logs -f app
```

Scan the displayed QR from WhatsApp → Linked devices. Then run `sudo
tailscale serve --bg 4756` and open the URL from `sudo tailscale serve
status` — no query param needed. Add a contact in the control app and
review shadow-mode logs before setting `SHADOW_MODE=0`. Check that the page
works from your allowed Tailscale login and is rejected for another login;
this live check is not automated.

The app uses host networking so its loopback-only control server is the
same `127.0.0.1` that host Tailscale proxies. Ollama stays in Compose and
is published on host loopback only. To update from GitHub, run:

```sh
git pull --ff-only
docker compose up -d --build app
```

Your `.env`, policy, WhatsApp session, SQLite data, and downloaded model
persist across app rebuilds. Back them up before host maintenance.
