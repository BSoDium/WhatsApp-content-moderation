# Design decisions

Durable rationale that doesn't belong in code comments or the README —
mostly *why*, not *what*. Some decisions live in the README instead because
they're better presented alongside the feature they shape: `deleteForMe`
validation and the classifier's fail-open contract/model choice are in
"Status" and "Classifier"; the self-host machine choice is in "Reference
hardware". This file covers everything else.

Update this file when a similar decision gets made — don't recreate a
one-off handoff note for it.

## Baileys over whatsapp-web.js

whatsapp-web.js drives a real headless Chromium via Puppeteer, which is
unnecessary weight for an always-on background host: extra RAM/CPU
overhead, a browser to keep patched, and one more thing that can crash.
Baileys talks the WhatsApp multi-device protocol directly over a WebSocket
— no browser, lighter footprint, and multi-device support is a first-class
concern rather than something bolted onto a web-client automation layer.

## The block/unblock cycle is itself a ban signal

Keeping request frequency low isn't the only ban risk. A recurring
block → wait → auto-unblock pattern is a distinctive automation signature
to Meta's abuse detection, independent of raw request volume — it's a
regular, machine-timed pattern on an account that's supposed to look like a
person occasionally blocking and unblocking a contact by hand.

Automated timed unblock was kept anyway (the simpler manual-unblock
alternative was considered and rejected) — but the unblock scheduler should
add random jitter to its check/unblock timing rather than firing on exact
intervals, as a partial mitigation against that pattern being recognizable.

### Trigger, duration, and jitter (issue #8 design)

- **Trigger**: a block fires the first time a contact's strike count (already
  tracked by `src/store/strikes.js`) reaches `STRIKE_THRESHOLD` (default
  **3**) *and* they have no currently-active block row
  (`SELECT ... FROM blocks WHERE contact_id = ? AND unblocked_at IS NULL`).
  Checked right after `moderation-pipeline.js` records a strike, inside the
  same per-contact `serialize()` chain `handleBurst` already uses — no
  separate idempotency guard needed at this layer, since two bursts for the
  same contact already can't run concurrently.
- **Duration**: `BLOCK_DURATION_MS` (default **24h**) plus jitter of
  `± BLOCK_JITTER_MS` (default **4h**, so 20–28h), computed once at block
  time and stored as `unblock_at` on the `blocks` row. The jitter lives in
  *when a block ends*, not in how often the scheduler looks — that's what
  actually varies the pattern an outside observer (or WhatsApp's abuse
  detection) would see.
- **Scheduler**: a poll loop, not a per-block `setTimeout` — timers don't
  survive a process restart, and this needs to run for a day at a time on a
  host that may restart. Every `UNBLOCK_POLL_INTERVAL_MS` (default
  **2 min**), check for rows where `unblock_at <= now() AND unblocked_at IS
  NULL`. The poll cadence itself doesn't need its own jitter — the
  already-randomized `unblock_at` is the signal that matters; the poll is
  just how promptly a due unblock gets noticed. A tick still running when
  the next one is due is skipped rather than overlapped, and a caller can
  await any tick already in flight before shutting down — see
  `src/pipeline/unblock-scheduler.js`.
- **Idempotency**: calls `updateBlockStatus(jid, 'unblock')` *before*
  `UPDATE blocks SET unblocked_at = ? WHERE id = ? AND unblocked_at IS NULL`
  — action first, record second, not the other way around. An earlier draft
  of this design had it reversed (claim the row, then call the API), but
  that fails closed: if the API call then throws, the row would already
  read as resolved with no way left to retry it, leaving the contact
  blocked forever. Calling the API first means a failed call just leaves
  the row alone for the next tick to retry (see AGENTS.md "Error
  handling" — never record an external action as done before it's
  confirmed). The remaining race this doesn't fully close — two overlapping
  ticks both calling `unblock` on the same contact before either marks the
  row — is harmless, since unblocking an already-unblocked contact is a
  no-op on WhatsApp's side; `markUnblocked`'s `changes === 0` return just
  tells the second caller it was redundant.
- The `blocks` table itself (`blocked_at`/`unblock_at`/`unblocked_at`) is the
  audit trail for block state changes — no separate `audit_log` entry needed
  for a block/unblock event, unlike message-level actions.

## Self-host over cloud

Decided early and not revisited: this runs on the user's own spare
hardware, not a cloud VM. Zero recurring cost, no inbound ports to expose or
firewall (the process only makes outbound connections — the WhatsApp
WebSocket and local/outbound calls to the LLM — so there's nothing to
listen on), and full control over where the `auth_info/` session keys
physically live rather than trusting a third party with them. See README
"Reference hardware" for which machine and why.

## State & audit log via SQLite

The three stores from README's "Planned architecture" — strike counts,
block records, and a message/classification audit log — all live in
SQLite, for one reason worth calling out: once a message is actually
deleted via `deleteForMe`, the audit log is the *only* remaining record of
what it said and why it was acted on. This is also why `AGENTS.md`'s
error-handling rule insists on logging classifier failures, not just
successes — the log needs to be trustworthy in both directions.

## Media messages are out of scope for now

Images and voice notes aren't classified — text only, for now. Revisit
explicitly if/when multimodal classification is worth the added complexity
and (for a CPU-only host) the added inference cost; don't silently expand
scope to cover media without deciding this again first.

## Manual override channel (issue #9)

The pause/status/unblock routines exist (`src/override/manual-override.js`),
but **WhatsApp self-chat commands are not, and won't be, the way to drive
them.** The issue's own follow-up comment called this out directly: a
`!pause`-style chat command is too primitive a control surface — no room
for things like rate limiting or a real view into what's happening, and it
doesn't compose with an actual UI. The plan instead, tracked as
[#29](https://github.com/BSoDium/WhatsApp-content-moderation/issues/29), is
a small web app hosted by the same process, reachable only over the
self-host's VPN — see "Web control app: Tailscale identity headers (issue
#29)" below for that app and what actually calls `runCommand()`.

An earlier version of this feature did parse `!pause`/`!resume`/`!unblock`/
`!status` out of the self-chat and reply there; it was removed for the
reason above, not because the routines themselves were wrong:

- **Pausing skips the pipeline entirely** rather than routing through
  shadow mode: no classification, no audit-log entry, nothing pushed to the
  buffer. `status` still works while paused since it reads the strike/block
  stores directly, not the buffer.
- **Pause state is in-memory only**, reset on restart. A restart already
  means someone is actively working on the host, so there's no scenario
  where losing the pause flag surprises anyone — persisting a flag whose
  whole purpose is a temporary human override would be the actual surprise.
- **`unblock` bypasses the jittered schedule but reuses its exact
  unblock-then-mark-resolved ordering** (`src/pipeline/unblock-scheduler.js`'s
  `runTick`): call `actions.unblock` first, only mark the local block record
  resolved if that succeeds. A failed WhatsApp call must leave the block
  record active for a later retry (manual or scheduled), not silently
  "succeed" locally while the contact stays blocked on WhatsApp.

Both of these still apply verbatim to whatever ends up calling
`runCommand()`.

## Web control app: Tailscale identity headers (issue #29)

`src/web/control-server.js` is the control surface #9 needed: a static
page plus a JSON API in front of `manual-override.js`'s
pause/resume/status/unblock routines. The interesting decision is
authentication, since "only reachable over the self-host's VPN" is not by
itself a fine-grained enough boundary — anyone else who can reach that VPN
(a guest, another device sharing it) shouldn't be able to pause moderation
or unblock a contact.

**Chosen: trust the `Tailscale-User-Login` header that `tailscale serve`
sets when proxying a tailnet request to a local port.** Tailscale has
already authenticated the connection (tailnet membership itself requires
signing in via the tailnet's own identity provider) before the request
ever reaches this app, so `src/web/tailscale-auth.js` only has to compare
that header against one allow-listed login (`ALLOWED_TAILSCALE_LOGIN`) —
no login page, no password, no session/cookie handling, and no custom
credential storage to get wrong. Chosen over the two other options raised
in #29:

- **GitHub OAuth SSO** — sound, but strictly more code (OAuth callback
  handling, state parameter, session cookie) for identity Tailscale is
  already providing for free once you're actually using Tailscale day to
  day, which is the case here. Left for later if this ever needs to run
  without Tailscale in front of it — #29 stays open for that.
- **Passkeys/WebAuthn directly** — ruled out for the reason already given
  in #29: relying-party config, credential storage, and origin/HTTPS
  requirements are real security-critical surface, disproportionate to a
  single-user control panel.

**The header alone is not enough, and a review of this feature caught why:**
the loopback bind stops *remote* tailnet peers from reaching the port
directly, but it does nothing about *local* ones — any other process or
user account already on this host can `fetch()` `127.0.0.1:<port>` and set
`Tailscale-User-Login` itself, with no `tailscale serve` and no tailnet
involved at all. Binding to loopback narrows who can reach the port; it
doesn't authenticate who's on the other end of a connection that already
got there.

**So there are two required factors, not one:** the header above, plus a
`CONTROL_SERVER_TOKEN` shared secret (`src/web/control-token-auth.js`,
constant-time compared) that has to travel with every request via an
`X-Control-Token` header, or a `token` query parameter for the very first
page load. Nothing about a locally-forged `Tailscale-User-Login` header
reveals this token, so the local-forgery path above is closed — an
attacker would need to already have read `CONTROL_SERVER_TOKEN` out of
`.env`, at which point they have host access this app was never going to
defend against anyway (see "`auth_info/` is a credential" below for the
same threshold). The token is deliberately *not* derived from anything
Tailscale sets, since the whole point is that it can't be reconstructed
from the one thing a local forger can already fake.

`createControlServer(...).listen()` still hardcodes the loopback interface
(`127.0.0.1`) rather than taking a host argument, and that's still
load-bearing: it's what keeps this to a two-factor local check instead of
an internet-facing one, and its documented behavior (`tailscale serve`
overwrites, not merges, inbound `Tailscale-User-*` headers) is still what
makes the first factor meaningful for *remote* tailnet peers. **Verify this
behavior live before enabling on a real deployment** — see README "Web
control app" for the manual check; nothing here has been confirmed against
a running `tailscale serve` yet.

**Docker note:** the bind-to-loopback guarantee only holds if the process's
`127.0.0.1` is the same one `tailscale serve` is proxying from. Under
`docker-compose.yml`'s default bridge network, the container's loopback is
its own — `network_mode: host` (or an equivalent) is required to run this
under Docker with Tailscale on the host. Not yet wired into
`docker-compose.yml`; treat this feature as bare-metal (`npm start`) only
until that's done.

State-changing endpoints (`/api/pause`, `/api/resume`, `/api/unblock`)
additionally require `Content-Type: application/json`. Auth here is
header-based rather than a same-origin cookie, so without this check a
malicious page open in the same browser could still trigger a mutating
request over the tailnet (the browser sends it regardless of which site
asked, since the tailnet is what authenticates it, not app-side state) —
classic CSRF, just with network identity as the ambient credential instead
of a cookie. Requiring a JSON content type forces a CORS preflight for any
cross-origin request, and since this server never sends
`Access-Control-Allow-Origin`, the browser refuses to send the real
request. No CSRF token or session needed for that.

## `auth_info/` is a credential

The `auth_info/` folder holds Signal protocol session keys equivalent to
full account access on the linked WhatsApp account. Treat it exactly like a
credential: gitignored (never commit it, even by accident), and encrypt at
rest on the host if practical.
