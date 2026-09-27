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
  tracked by `src/store/strikes.ts`) reaches `STRIKE_THRESHOLD` (default
  **3**) *and* they have no currently-active block row
  (`SELECT ... FROM blocks WHERE contact_id = ? AND unblocked_at IS NULL`).
  Checked right after `moderation-pipeline.ts` records a strike, inside the
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
  `src/pipeline/unblock-scheduler.ts`.
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

The three stores from README's "Architecture" — strike counts,
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

The pause/status/unblock routines exist (`src/override/manual-override.ts`),
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
  unblock-then-mark-resolved ordering** (`src/pipeline/unblock-scheduler.ts`'s
  `runTick`): call `actions.unblock` first, only mark the local block record
  resolved if that succeeds. A failed WhatsApp call must leave the block
  record active for a later retry (manual or scheduled), not silently
  "succeed" locally while the contact stays blocked on WhatsApp.

Both of these still apply verbatim to whatever ends up calling
`runCommand()`.

## Multi-contact moderation roster (issue #32)

Originally this ran against exactly one `TARGET_CONTACT_JID` env var. The
pipeline, buffer, and all three SQLite stores were already parameterized by
`contactId` throughout — only `index.ts`'s wiring and
`manual-override.ts`'s constructor-bound target and global `paused` flag
carried the single-contact assumption, so extending to many contacts was a
wiring change, not a rearchitecture.

**Roster is a new `monitored_contacts` table** (`contact_id`,
`escalation_enabled`, `added_at`), managed entirely through the control
app's picker — there is no env-var equivalent of `TARGET_CONTACT_JID`
anymore, and no migration path from it: this is pre-release with no real
users to migrate, so the env var was removed outright rather than kept as a
deprecated fallback. A consequence worth being explicit about: without
`WEB_CONTROL_PORT` configured, there is no way to add a contact to the
roster, so the moderator does nothing at all — this is intentional, not an
oversight, but it means the control app changed from optional to required
for this build to be useful.

**Escalation is per-contact and gates only the block step.** Disabling it
(`escalation_enabled = 0`) still lets `moderation-pipeline.ts` classify,
delete-for-me, warn, record strikes, and audit-log every message exactly as
before — `maybeBlockContact` just returns early instead of calling
`block()`/`createBlock()`. This matters because a contact you can't afford
to actually block on WhatsApp (the reason the toggle exists) still
benefits from the rest of the moderation, and because an inconsistent
strike count would make re-enabling escalation later behave surprisingly.

`isEscalationEnabled` defaults to **false** (not true) for a contactId with
no roster row at all — the only way `maybeBlockContact` reaches that case is
a contact removed from the roster while a burst for them was already
buffered or in flight (roster membership is checked before buffering, but
`removeMonitored` doesn't cancel work already queued for a contact). Failing
toward *not* blocking is the safe direction for that race: blocking someone
who was already removed (or who had escalation off) is a real, hard-to-undo
action, while skipping a block just leaves the existing strike/delete/warn
path to handle it on the next message.

**Removing a contact from the roster keeps its history.** `removeMonitored`
only deletes the roster row — strikes, blocks, and audit-log rows for that
`contact_id` are untouched, matching this project's existing principle that
the audit log is the permanent record (see "State & audit log via SQLite"
above). Re-adding the same contact later picks up wherever its strike count
already was.

**Known limitation, not yet solved:** `src/whatsapp/contact-directory.ts`
keys contacts by whatever id each Baileys event reports (the same id space
`moderation-pipeline.ts` already keys off `msg.key.remoteJid`), and does not
cross-reference Baileys 7's split `@lid`/`@s.whatsapp.net` id spaces for the
same underlying person — there's no documented stable mapping between them
in this Baileys version. In practice this means the same real contact could
theoretically appear as two different roster entries if WhatsApp ever
routes their messages under both forms. Revisit if that's observed to
actually happen.

**The directory is persisted (`contacts` table), not in-memory.** Baileys
only emits `messaging-history.set` (the phone's synced address book) on a
contact's very first login — a reconnect that reuses an existing
`auth_info/` session never re-fires it. An in-memory directory therefore
started empty on every restart, and the picker only ever filled back in as
people happened to message again, which is the wrong UX for "browse my
whole contact list." Persisting means a contact learned once, however that
happened, stays known across restarts, and the roster only grows over time
instead of resetting.

**`connectWhatsApp` sets `syncFullHistory: true`.** WhatsApp's multi-device
protocol has no request/response "list all contacts" call — everything is
event-driven, and the one bulk sync (`messaging-history.set`) only fires
once, at the moment a device is freshly linked (QR scan). Without this
flag that one-time sync is a recent/trimmed window; with it, it's the
phone's complete history. It only matters at link time — a reconnect using
an existing `auth_info/` session never re-requests history, full or not —
so getting a complete initial contact list means deleting `auth_info/` and
re-scanning the QR code at least once with this flag already in place.

## Control panel: full contact list + slide-in detail panel

The original picker+tabs control-panel UI (see "Web control app" below) was
replaced after real usage surfaced it as bad UX: a bare search box with no
visible results until you'd already focused it, no guidance text, and a
numeric search that silently failed because Baileys JIDs never contain the
`+` a user naturally types when searching a phone number. The redesign,
styled after WhatsApp's own chat list:

- **The full contact directory is the default view**, not just the
  monitored roster — one scrollable list, avatar + name + a relative
  "Last contacted" subtitle, sorted most-recently-contacted first. A switch
  on each row directly toggles moderation on/off (`POST`/`DELETE
  /api/roster`), replacing the old add-then-separately-remove flow.
- **The list pane is always exactly 50% of the viewport** (floored at a
  `--list-min-width: 500px`, below which the whole layout collapses to a
  single full-width column — see the `1000px` media query, `2×` the floor).
  Centered while browsing; clicking a row (not the switch) docks it flush
  left and opens a detail panel in the other 50% — an explicit width on
  each side, not flex-grow distributing space between them, so neither can
  ever encroach on the other. Below the `1000px` floor the detail panel
  becomes a full-screen overlay with a back button instead, replacing the
  old tab-strip-of-monitored-contacts model outright, since only one
  contact's detail is ever open at a time regardless of how many are
  monitored. The panel drops the old separate "stop monitoring" button —
  the same on/off switch, mirrored at the top of the panel, already covers
  it. This layout is tuned for desktop; the sub-`1000px` floor is a usable
  fallback, not a tuned mobile experience yet.
- **Panel controls are always rendered, never hidden.** A contact that
  isn't monitored yet still shows the full strikes/block/paused/escalation/
  unblock layout — just `disabled` (and dimmed via the existing
  `button:disabled`/`.switch:disabled` styling) rather than replaced with a
  bare guidance paragraph. An empty-looking panel read as broken; disabled
  controls read as "not turned on yet," and flipping the monitor switch
  just lifts the `disabled` attributes in place rather than swapping the
  panel's markup out from under the user.
- **Search matches name by substring and number by digits-only
  comparison** (`query.replace(/\D/g, '')` against `id.split('@')[0]`) so a
  query like `+33769300481` still matches a JID that has no `+` in it.
- **Avatars are generated initials, not real photos**, deliberately: real
  WhatsApp profile photos would need a fetch+cache layer and a proxy route
  (Baileys' `profilePictureUrl(jid)` isn't something you can safely call
  once per contact for a whole list without rate-limiting), which is
  meaningfully more backend work than this redesign's scope. The avatar
  markup is isolated in its own `renderAvatar()` function specifically so a
  later photo feature can swap its internals without touching row/panel
  layout. **Since implemented** — see "Real WhatsApp profile photos: lazy,
  bounded, proxied" below; initials remain the fallback whenever there's no
  photo or its lookup fails.
- **The subtitle is a timestamp only, never a message preview** — showing
  what someone actually said, for a contact that isn't even being
  moderated yet, is a bigger privacy footprint than this app should default
  to.

**`contacts.last_message_at` is a one-off `ALTER TABLE` migration, not
folded into `CREATE TABLE IF NOT EXISTS`.** This project's stated
"pre-release, no migrations" stance (see "Multi-contact moderation roster"
above) is specifically about roster/env-var concepts that are fine to drop
outright — it was never meant to justify silently losing a `contacts` table
a user can only repopulate by actually relinking their WhatsApp device via
QR code. `getDb()` checks `pragma_table_info('contacts')` for the column
and adds it if missing, once, right after creating the schema.

**`last_message_at` is seeded two ways**: `messaging-history.set`'s `chats`
array (each entry's `conversationTimestamp`) backfills it once at link time
for every contact synced before this feature existed, and every live
`messages.upsert` event (either direction — sending or receiving both
count as "contacted") advances it from then on, always taking the `MAX` of
old vs. new rather than last-write-wins, so an out-of-order event can never
regress it. This tracking is deliberately separate from the moderation
pipeline's own `messages.upsert` handling in `index.ts` (which only
processes monitored contacts) — this one runs for every contact, since the
whole point of the list is to show *everyone*, not just who's being
moderated.

**The open/close animation is sequenced (slide, then fade), not
simultaneous.** The first pass animated the list pane's centering via
`margin: 0 auto` → `margin: 0` and the detail pane's reveal via `width: 0`
→ `50%` at the same time — `auto` has no defined interpolation for a CSS
transition (it just snaps), so the list wasn't actually animating at all,
and the detail pane's width-reveal alone read as the viewport "uncovering"
a static box rather than anything sliding. Fixed by expressing the list
pane's position as an explicit `margin-left` (`25%` closed — the space
that centers a 50%-wide box — `0` open, both concrete values, so the
transition is well-defined) and adding a `transition-delay` to the detail
pane's *opacity* equal to its own width transition's duration: the space
opens immediately (in the same beat as the list sliding out of it), and
only once that's finished does the content — invisible until then — fade
in. The opacity lives on `.detail-pane` itself (the persistent element
`app.js` only ever changes the `innerHTML` of) rather than on the
freshly-recreated `.detail-pane__inner`, since a transition only plays
across a genuine before/after change on the *same* element — a brand-new
element born already-styled never gets one, but a persistent parent's
opacity change visually cascades to whatever was just inserted into it
regardless of timing.

## Web control app: Tailscale identity headers (issue #29)

**Partially superseded.** This entry's auth mechanism (the
`CONTROL_SERVER_TOKEN` shared secret + cookie described below) was replaced
by a `whois`-based design and then, after that design turned out not to
work, reverted to header-only trust with no token at all — see "Web control
app: back to trusting the header (issue #29, twice revisited)" below for
what's actually in place today. Kept here for the reasoning trail: why a
second factor seemed necessary at the time, and the CSRF analysis it
produced, most of which still holds even though the token itself is gone.

`src/web/control-server.ts` is the control surface #9 needed: a static
page plus a JSON API in front of `manual-override.ts`'s per-contact
pause/resume/unblock routines, `contact-directory.ts`'s known-contacts
list, and the monitored-contacts roster (see "Multi-contact moderation
roster" above). The interesting decision here is
authentication, since "only reachable over the self-host's VPN" is not by
itself a fine-grained enough boundary — anyone else who can reach that VPN
(a guest, another device sharing it) shouldn't be able to pause moderation
or unblock a contact.

**Chosen: trust the `Tailscale-User-Login` header that `tailscale serve`
sets when proxying a tailnet request to a local port.** Tailscale has
already authenticated the connection (tailnet membership itself requires
signing in via the tailnet's own identity provider) before the request
ever reaches this app, so `src/web/tailscale-auth.ts` only has to compare
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
`CONTROL_SERVER_TOKEN` shared secret (`src/web/control-token-auth.ts`,
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

The bootstrap link (`https://<hostname>/?token=<CONTROL_SERVER_TOKEN>`)
carries that token in cleartext until the page's own script moves it into
`localStorage` and strips the query string — still not something to paste
into chat, a shared note, or persistent shell history. Regenerate
`CONTROL_SERVER_TOKEN` if that link is ever exposed that way (see README
"Web control app").

**`localStorage`, not `sessionStorage`, deliberately.** The original choice
was `sessionStorage` specifically so the token behaved like a one-time
credential — gone the moment the tab closed. In practice that meant
retyping (or re-pasting) the full token link every time the operator
reopened the page in a new tab, which is exactly the kind of friction that
leads to a token getting pasted somewhere it shouldn't. `localStorage`
persists across tabs and reloads until explicitly cleared, trading that
one property (a stolen/shared browser profile keeps a working credential
indefinitely, not just for the current tab's lifetime) for not needing the
link again. Accepted for a single-operator tool on a device only the
operator uses; the two-factor gate (Tailscale identity + this token) is
unchanged either way — a cross-origin page still has no way to read
another origin's `localStorage` any more than its `sessionStorage`, so the
CSRF reasoning below is unaffected by this switch.

`createControlServer(...).listen()` still hardcodes the loopback interface
(`127.0.0.1`) rather than taking a host argument, and that's still
load-bearing: it's what keeps this to a two-factor local check instead of
an internet-facing one, and its documented behavior (`tailscale serve`
overwrites, not merges, inbound `Tailscale-User-*` headers) is still what
makes the first factor meaningful for *remote* tailnet peers. **Verify this
behavior live before enabling on a real deployment** — see README "Web
control app" for the manual check; nothing here has been confirmed against
a running `tailscale serve` yet.

**Docker note:** Compose uses `network_mode: host` for the app so its
loopback is the same one host `tailscale serve` proxies. Ollama remains on
the Compose network and publishes port 11434 on host loopback only; the app
connects to `127.0.0.1:11434`. The app image must include the built
`web/dist` bundle, produced by the Dockerfile's frontend build stage.

State-changing `POST` endpoints (adding a roster contact, pause/resume/
unblock, toggling escalation) additionally require `Content-Type:
application/json`. With `CONTROL_SERVER_TOKEN` in place, that token is the
primary CSRF defense: a cross-origin page has no way to read
`localStorage` or attach `X-Control-Token` itself, so it can't produce a
request this server accepts no matter how it's triggered. The Content-Type
check is a second, independent layer for the case the token is obtained
some other way (e.g. leaked via the bootstrap URL, see above) — it forces a
CORS preflight for any cross-origin request, and since this server never
sends `Access-Control-Allow-Origin`, the browser refuses to send the real
request even with a correct token attached. `DELETE /api/roster/:contactId`
doesn't need the same check: unlike `POST`, `DELETE` isn't a
CORS-safelisted method, so a cross-origin request against it already forces
a preflight regardless of Content-Type — adding the check there would just
be validation for a scenario that can't happen. Neither layer depends on a
session or a CSRF token of its own.

**A `controlToken` cookie, accepted on `GET /` only — fixing a real gap,
not a client-storage bug.** The switch to `localStorage` (above) didn't
actually fix "reloading the page fails" — it only ever helped `app.js`'s
own `fetch()` calls attach `X-Control-Token`. `GET /` itself is a plain
browser navigation, which happens *before* any of this page's JS runs, and
a browser never attaches a custom header to a navigation the way `fetch()`
can — so once the bootstrap link's `?token=` query param is stripped from
the URL (deliberately, so it doesn't linger in the address bar/history),
there was no way left for a plain reload to ever pass `GET /`'s auth check
again, no matter what was in `localStorage`. A cookie is the one credential
type a browser *does* attach automatically to a navigation, which is
exactly the gap here.

`src/web/control-token-auth.ts`'s `verifyControlCookie` reads a
`controlToken` cookie and is accepted **only** by `GET /`, set (and its
expiry refreshed) on every successful load of that route — `/api/*` still
authenticates via `verifyControlToken`'s header/query check exclusively,
completely unchanged. This split matters: a cookie is exactly what a
cross-origin page can also have the browser attach on its behalf (the
classic CSRF vector), whereas the custom header cannot be forged that way
— accepting the cookie on state-changing routes too would quietly undo the
CSRF reasoning directly above this entry. `GET /` itself has no side
effects to protect against CSRF in the first place (loading a page isn't a
mutation), so accepting the cookie there carries none of that risk. The
cookie is `HttpOnly` (this page's own JS never needs to read or set it —
the browser handles the `Set-Cookie` response header and its automatic
replay entirely on its own) and `Secure`/`SameSite=Strict`, with a 400-day
`Max-Age` (the practical ceiling Chrome enforces regardless of what's set)
so it doesn't meaningfully expire sooner than `localStorage` effectively
does.

## Web control app: replacing the header+token with LocalAPI WhoIs (issue #29 revisited)

**Superseded — reverted.** The `whois`-based design below does not work:
live testing found `tailscale whois` returns `peer not found` for a
`tailscale serve`-proxied backend connection's loopback address, even
queried synchronously while the connection was still open, and
`tailscaled`'s own source confirms why (`ipn/ipnlocal/serve.go` has a
`TODO(bradfitz): do the RegisterIPPortIdentity and UnregisterIPPortIdentity
stuff that netstack does` on exactly this proxy path) — the identity
registration `whois` depends on is implemented for `tsnet`-style apps that
terminate the tailnet connection themselves, not for `serve`'s
reverse-proxy-to-a-separate-backend path this app uses. `verifyTailscaleWhoIs`
would have returned `false` for every request in production: fail-closed as
designed, so not a security hole, but a completely non-functional control
app. See "Web control app: back to trusting the header (issue #29, twice
revisited)" below for what replaced it. Kept here, not deleted, for the
reasoning trail — including why it looked right from documentation and
`tsnet` examples alone, and why it needed a live test to catch.

The header+token design above got its first live confirmation: an operator
finishing the Debian install got a 403 whose log line
(`rejected: missing or invalid control token`) showed the
`Tailscale-User-Login` header matching correctly — the open question in the
entry above, about whether `tailscale serve` actually sets that header the
way this app relies on, is resolved for at least one real login. The 403
itself wasn't a bug: `GET /` requires `?token=<CONTROL_SERVER_TOKEN>` on the
very first visit specifically (only that visit sets the `controlToken`
cookie subsequent plain reloads rely on), and the operator had opened the
bare tailnet URL instead. Asked directly, they didn't want the bootstrap
step made clearer — they wanted to know if a token was needed at all.

**Chosen: drop the shared secret. Ask `tailscaled`'s own local API who owns
the connection, per request, instead of trusting a header.** `tailscaled`
exposes `GET /localapi/v0/whois?addr=<ip:port>` over a Unix-socket-only HTTP
API — the same data `tailscale whois` prints. This works for an app sitting
behind `tailscale serve`, not only for a `tsnet`-based node: when `tailscale
serve --bg 4756` proxies a real tailnet request to `127.0.0.1:4756`,
`tailscaled` itself opens that backend connection from an ephemeral local
port it tracks internally, and `whois` on *that specific address* resolves
the real tailnet peer — because `tailscaled`, not this app or the client, is
the one who knows the mapping. `src/web/tailscale-whois-auth.ts` calls this
with `req.socket.remoteAddress`/`remotePort` (the actual observed TCP peer
of the connection carrying the request) on every `GET /` and `/api/*` call,
replacing both `src/web/tailscale-auth.ts` (header trust) and
`src/web/control-token-auth.ts` (the shared secret) — both deleted, not
just unused.

**This closes the same local-forgery gap the token did, without a secret to
manage.** The token existed because the header alone wasn't proof a request
came through `tailscale serve`'s proxy hop rather than some other local
process on this host calling `fetch()` on `127.0.0.1:4756` directly and
setting the header itself. A forged connection like that gets its own,
distinct ephemeral port — one `tailscaled` has no record of proxying
anywhere — so `whois` on it returns no result, and
`verifyTailscaleWhoIs` fails closed. The forger can no longer just know a
header name and value; they'd need `tailscaled` itself to already believe
their specific connection is a live proxied one, which they can't produce
by connecting fresh. **Fail-closed is the whole safety property here**: any
`whois` error, timeout, non-200, malformed body, or absent profile must
resolve to "not authenticated," same as a login mismatch — silently
trusting an unreachable `tailscaled` would recreate the exact hole this
change closes.

**Everything the token/cookie system existed for goes away with it.** No
`?token=` bootstrap link, no `controlToken` in `localStorage`, no
`Set-Cookie` on `GET /`, no distinction between what `GET /` alone accepts
and what `/api/*` requires — there's exactly one check now, and it runs on
every request, not just the first one. The frontend's `web/index.html`
bootstrap script and `web/src/lib/api.ts`'s `getToken()`/`X-Control-Token`
attachment are deleted, not superseded-but-kept, since nothing consumes
them any more.

**Superseded — the CSRF paragraph above** ("With `CONTROL_SERVER_TOKEN` in
place, that token is the primary CSRF defense"): re-examined, since removing
it must not reopen that gap. The token's only actual CSRF-relevant role was
being accepted as a **cookie**, and only on `GET /` — the one path a
cross-origin page could get a browser to attach a credential to
automatically. `GET /` has no side effects and its response isn't
cross-origin-readable, so that exposure was already narrow before this
change. Every state-changing route requires either `Content-Type:
application/json` (POST; not CORS-safelisted, forces a preflight) or is a
`DELETE` (also non-simple) — and this server has never sent
`Access-Control-Allow-Origin`, so the forced preflight already blocks the
real cross-origin request regardless of any token or cookie. Removing the
token also removes its one cookie-shaped CSRF surface; the preflight
mechanism that was actually doing the work for mutating routes is
unchanged. `src/web/control-server.test.ts` asserts no response ever
carries `Access-Control-Allow-Origin`, locking this in.

**Real open risk, not yet resolved by anything above: `tailscaled`'s socket
is normally root-owned, and this app's container runs as UID 1000** — a
documented deployment invariant (see `AGENTS.md`'s "Deployment invariants"),
not incidental. Bind-mounting the host socket into the container
(`docker-compose.yml`) doesn't by itself prove UID 1000 can connect to it.
Untested as of this writing whether `sudo tailscale set
--operator=<host-user>` (mapping to a real host account with UID 1000)
grants `whois` access specifically, rather than just CLI command rights. If
UID 1000 genuinely cannot reach the socket, the fallback — running the
control-server process as root, or as whatever UID the socket allows — is a
real deviation from that invariant requiring an explicit decision, not a
default to apply quietly. See README "Web control app" for the exact
commands to check this on a real host before relying on any of the above.

**Alternative considered and rejected: run the app as its own `tsnet` node**
(a fully self-contained Tailscale node inside the process, using a
userspace WireGuard stack), which is how Tailscale's own Go examples
typically pair with `whois`. Rejected for this codebase specifically
because `tsnet` has no maintained Node.js equivalent — porting would mean
either shelling out to a Go helper binary or losing the guarantee entirely,
neither of which is simpler than calling the existing `tailscaled`'s local
API over its Unix socket, which requires no new process and no language
boundary. It also would have meant giving up `tailscale serve`'s TLS
termination and MagicDNS hostname, both of which this app gets for free
today.

**This alternative is what the rejection above actually should have been
weighed against — not "an app with a shared secret" but "an app trusting the
header alone."** Rejected here for the same reason: no maintained Node.js
`tsnet`, and a Go helper process is a bigger lift than this project's stack
currently justifies. It remains the correct fix if the single-operator
assumption in the next entry ever stops holding.

## Web control app: back to trusting the header (issue #29, twice revisited)

The `whois` design above was verified live before being trusted further —
consistent with this project's own practice of not shipping an unverified
assumption about `tailscale serve`'s behavior a second time. The result was
conclusive: on a real tailnet, hitting a real `tailscale serve` rule
proxying to a plain HTTP server, `tailscale whois <the observed loopback
address:port>` returned `peer not found`, both immediately after the
request and while the connection was still being handled. `tailscaled`'s
own source explains why (quoted in the entry above) — this is a genuine
capability gap in `tailscale serve`'s proxy path, not a permissions issue,
a macOS-vs-Linux difference, or a mistake in how the address was formed.

**Chosen: trust `Tailscale-User-Login` directly, drop `whois` entirely,
keep everything else about the redesign.** `src/web/tailscale-auth.ts`
(deleted in the `whois` change) is restored verbatim — the header-checking
logic itself was never wrong, only the belief that it could be replaced
with something strictly stronger while keeping this exact architecture. What
survives from the `whois` attempt: no `CONTROL_SERVER_TOKEN`, no bootstrap
link, no cookie, no distinction between a first visit and a later one — all
of that was correct and doesn't depend on which identity check backs it.

**The trade-off this reintroduces, made explicit rather than mitigated:**
the loopback bind stops remote access, but any other local process or user
account on this host can still `fetch()` `127.0.0.1:<port>` and set
`Tailscale-User-Login` itself — exactly the gap `CONTROL_SERVER_TOKEN`
existed to close, see "Web control app: Tailscale identity headers" above.
Asked directly, the operator confirmed they are the only account with shell
access to this host, which is the condition under which this gap has no
practical attacker: there's no other local identity for a forged request to
belong to. **This is a property of the deployment, not the code** — if this
host ever gets a second local user account or runs software the operator
doesn't fully trust, this assumption needs revisiting, and the real fix at
that point is the `tsnet`-based approach noted as a rejected alternative
above, not a new shared secret bolted back on.

## Control page styling: three files, two of them unauthenticated

A first code-review pass on the control page kept it as one self-contained
`index.html` (inline `<style>`/`<script>`), reasoned about at the time as
the lighter option and a way to avoid an auth question — see this entry's
prior text in git history. A second pass (issue #32)
asked for real UI: a contact picker, per-contact tabs, a card component for
errors, and a genuine headline font — enough new surface that inlining
stopped being the more maintainable option, the exact trigger the original
entry called out for revisiting this.

**Chosen: split into `index.html` + `styles.css` + `app.js`, with the CSS
and JS files deliberately unauthenticated.** `GET /` and every `/api/*`
route still require both auth factors exactly as before — nothing about
the two-factor model changes for state or secrets. Only the static bytes of
`/styles.css` and `/app.js` move outside the gate, and that's safe for a
reason specific to what those files are: a `<link rel="stylesheet">` or
`<script src>` tag cannot attach the `X-Control-Token` header the way a
`fetch()` call can, so gating them would only break the page rather than
protect anything — neither file contains the control token or any other
secret (the token exists only at runtime, in the browser's
`localStorage`, populated by a small bootstrap script that stays inline
in `index.html` specifically so it can run synchronously before either
external file loads). `app.js` reads that token back out of
`localStorage` itself at request time, which is fine even though the
file's *source* is servable to anyone — an unauthenticated file only means
its code is public, not that it can read another visitor's stored token.

**Superseded**: there is no control token, bootstrap script, or
`localStorage` credential any more — see "Web control app: replacing the
header+token with LocalAPI WhoIs (issue #29 revisited)" above. The
reasoning above still explains why splitting unauthenticated CSS/JS out was
safe at the time; it just no longer describes what those files do today.

**Superseded**: the page originally self-hosted a headline serif font
(Source Serif 4, SIL OFL) embedded as a base64 `data:` URI directly inside
`styles.css`'s `@font-face` rule, to keep the auth exemption at exactly the
two routes above instead of adding a third for a font file. Dropped after
the contact-list redesign (see "Control panel: full contact list +
slide-in detail panel" above) in favor of a plain monospace font *stack*
(`ui-monospace`, `'Roboto Mono'`, platform fallbacks, `monospace`) with no
webfont file at all — every OS already ships a solid monospace font, so
there's nothing to fetch, license, or embed, and the auth-exemption
reasoning above no longer needs to account for a font file either way.

**`styles.css` is now a compiled Tailwind CSS build, not hand-written.**
Hand-rolled CSS (first a WhatsApp-green glass treatment, before that a
plain custom stylesheet) repeatedly fell short of a clean, minimal look
the user could point to a reference for ("shadcn", "Apple Liquid Glass").
Tailwind gets a real, well-tested neutral design scale (spacing, radius,
shadows, the zinc color palette) instead of guessing those values by hand
— but only as a *build-time* tool: `src/web/tailwind.src.css` (the
authored source, `@tailwind` directives + this page's custom classes,
mostly via `@apply`) compiles via `npm run build:css`
(`tailwindcss -i ... -o src/web/styles.css --minify`) to the exact same
`src/web/styles.css` this page has always served. **Deliberately not** the
Tailwind CDN/"Play" script (`<script src="https://cdn.tailwindcss.com">`)
— Tailwind's own docs call that build prototyping-only, and it would mean
an authenticated page that controls a real WhatsApp account executes
arbitrary third-party JS from a CDN on every load. The compiled approach
keeps the exact same posture as before: `styles.css` is still just a
static file with zero runtime dependencies, generated instead of
hand-written, committed to git same as always (no CI/build pipeline exists
to regenerate it on deploy, so a stale build would otherwise silently ship
old styles). `tailwind.config.js`'s `content` globs
(`src/web/index.html`, `src/web/app.ts`) only affect which utility classes
get generated — they don't change what actually loads in the browser.

**Palette: neutral black/white/gray (Tailwind's `zinc` scale), not
WhatsApp's green.** The redesign's first pass ("Control panel: full
contact list + slide-in detail panel" above) leaned on WhatsApp's own
teal-green as the accent, reasoning the app should look like what it
moderates. Superseded once the ask sharpened to a specific reference
(shadcn's own default neutral theme) — `--color-accent` is `zinc-900`
(near-black) in light mode, `zinc-50` (near-white) in dark mode, used for
the switch's checked state and interactive emphasis generally, rather than
a colored accent.

**`npm run dev` originally used Node's built-in `--watch`, not `nodemon` —
superseded by `nodemon` after `--watch-path` turned out not to scope
anything on this project's Node build.** The original reasoning: Node 20+
ships file-watching restart natively (`--watch`), so there's no reason to
add a dependency that exists purely to re-implement it, and `--watch-path`
should scope what's watched explicitly rather than the whole project. A
first bug under that design — passing `./index.ts` as its own extra
`--watch-path` entry broadened scope enough to pick up
`auth_info/creds.json` (rewritten on every WhatsApp reconnect),
restart-looping the connection — was fixed by dropping that redundant
entry, keeping only `--watch-path=./src`. That fix looked complete at the
time (`npm test` and manual use were both fine) and shipped for a while.

**It wasn't actually complete.** While chasing a live 502-under-normal-use
bug (see "Control page styling" below), later testing found `--watch-path`
doesn't reliably exclude anything at all on this Node build, regardless of
scope: with the value made absolute (`--watch-path="$(pwd)/src"`), the
server *still* restarted on a touched `web/dist/index.html`. Pushed
further — pointing `--watch-path` at a throwaway empty directory
completely unrelated to the project, with `auth_info/creds.json` still
being rewritten by a live WhatsApp reconnect in the background — the
server restarted on that creds.json write anyway, proving `--watch-path`
wasn't excluding *anything*; whatever Node was actually watching, it wasn't
scoped by this flag at all. Since a live connection rewrites
`auth_info/creds.json` on every reconnect, and a restart itself forces a
reconnect, this is a self-sustaining restart storm baked into the dev
server's normal idle state — not something that needs a file edit to
trigger — which lines up with a user report of "a lot of 502 failures...
when you update the status of an item... or hard reload" (a request that
lands mid-restart gets connection-refused from `tailscale serve`) and the
page sometimes not loading at all (a request landing in the dead window
between SIGTERM and the new process's `listen()` call). Whether this is a
genuine bug in this Node version or some undocumented interaction wasn't
investigated further, because it doesn't matter for the fix: **the
underlying flag can't be trusted to exclude anything here**, at any path
form.

**Fixed by switching to `nodemon`, whose own `--watch <path>` was verified
(same throwaway-directory-style test, plus a live reconnect running in the
background) to correctly restart only on a genuine `src/` change** — the
exact scoping the original decision wanted from `--watch-path` and didn't
get. `dev:server` is now `nodemon --watch src --exec "node
--env-file-if-exists=.env" index.ts`. The dependency-avoidance reasoning
from the original decision no longer applies: the built-in flag doesn't do
the one job it needed to do, so there's nothing left to avoid re-implementing.

`concurrently` runs `dev:server` alongside the frontend's own `--watch`
build (see below), and forwards Ctrl+C to both — the alternative (a bare
`&`-backgrounded shell job) doesn't reliably kill the backgrounded process
on interrupt.

**Superseded: the hand-rolled-then-Tailwind-compiled vanilla CSS/JS above
was replaced with a Vite + React frontend using real shadcn/ui
components.** The user had pointed at shadcn as a *style reference* for
several rounds (see "Palette" above); eventually the ask sharpened to
literally stop hand-building components/CSS and use shadcn's own component
library. shadcn/ui ships React components (Radix UI primitives underneath,
via its CLI's `npx shadcn add <component>`) — there's no vanilla-JS
distribution — so adopting it for real meant adding a frontend framework
and build step, not just a new CSS file. Given that scope jump, the user
was asked (and chose) a full React migration over a "shadcn look without
React" alternative that would have hand-copied shadcn's CSS recipes into
plain classes.

**Chosen: a separate `web/` directory, its own `package.json`/`node_modules`,
scaffolded via `npm create vite@latest` (React template) + `npx shadcn@latest
init` (Nova preset, Radix base, neutral/zinc-equivalent OKLCH palette —
achromatic black/white/gray, matching the palette decision above almost by
coincidence since Nova's default *is* a neutral theme).** Kept as a second
`package.json` rather than folding React/Vite/shadcn's deps into the root
one: the root project is a Node ESM backend with its own dependency set
(Baileys, pino, better-sqlite-equivalent, …) and its own test runner: mixing
in a frontend toolchain's much larger, faster-moving dependency tree (React,
Vite, Radix, Tailwind v4) would make both harder to reason about, and
`npm create vite`/shadcn's CLI both assume they own the `package.json` in
their working directory rather than merging into an existing one. Root
`package.json` gained thin orchestration scripts instead
(`build:web`/`watch:web` → `npm run --prefix web build`/`watch`).

**Reconsidered during review, not changed: an npm workspace would get the
same dependency-tree isolation with fewer seams.** Two independent
lockfiles, the `npm run --prefix web` indirection in every root script, and
`pretest` needing a full frontend build before backend unit tests can run
at all are all real friction this two-`package.json` split pays for, and a
single-root-lockfile npm workspace keeps the two dependency trees just as
separate without any of it. Left as-is for now rather than restructured
mid-review — the coming TypeScript migration will touch this same tooling
boundary anyway (tsconfig project references, a shared build step), so
it's a more natural point to revisit than a standalone change today.

**Tailwind v4, not v3.** shadcn's current CLI scaffolds Tailwind v4 by
default (`@tailwindcss/vite`, CSS-first config via `@theme`/`@import
"tailwindcss"` — no more `tailwind.config.js` content globs), and fighting
that default back down to v3 for consistency with the now-deleted
`tailwind.src.css` would have meant manually maintaining compatibility
shims shadcn's own components don't expect. `web/src/index.css`'s
`@theme`/`:root`/`.dark` blocks (generated by `shadcn init`, not
hand-written) are the direct replacement for the old hand-authored
`--color-*` custom properties.

**Vite build output is served, not Vite's own dev server.** The obvious
"real" dev setup would run `vite`'s dev server (HMR) with `/api/*` proxied
to the Node backend. Rejected: this app's entire auth model
(`docs/decisions.md`'s "Web control app: Tailscale identity headers")
depends on `tailscale serve` being the *only* path to the backend, and on
every request — including `GET /` — carrying a `Tailscale-User-Login`
header that only that proxy hop sets. A second, separate origin (Vite's own
dev server) would either need its own `tailscale serve` mapping (doubling
the trusted-proxy surface for zero production benefit) or bypass the proxy
entirely during dev, testing an auth path that doesn't match production.
Instead, `web/` is only ever *built* (`vite build`, optionally `--watch`)
into `web/dist/`, and `control-server.js` serves that directory exactly
like it served the old hand-written `index.html`/`styles.css`/`app.js` —
one origin, one auth model, in dev and production alike. The cost is no
HMR (a full rebuild + a plain browser reload per change instead — not a
*server* restart; see the next entry for why it was briefly wired up to
restart the server too, and why that turned out to be a bug rather than a
feature), acceptable for a personal single-user tool.

**`control-server.js` serves `web/dist/` per-request, not from a cache read
once at startup — and the backend no longer restarts on a frontend
rebuild at all.** The first version of this change kept the old two-file
eager-`readFileSync`-at-startup pattern, generalized to `readdirSync` over
`web/dist/assets/` (Vite content-hashes every output filename, so a fixed
`STATIC_ASSETS` map doesn't work any more), and added `web/dist/` to
`dev:server`'s `--watch-path` so a frontend rebuild would restart the
server and pick up the new hashes. **This was a real bug, not a
simplification**: `vite build --watch`'s incremental rebuild isn't atomic
— it can briefly leave `web/dist/assets/` with the old files deleted and
the new ones not yet written — and `node --watch` restarting mid-window
hit that exact half-written state, crashing on the eager `readdirSync`
inside the process's own module-load (uncaught, since it ran before the
request handler's try/catch existed), which then sat crashed until the
*next* file change nudged `--watch` into trying again (matching a user
report of intermittent 502s on routine actions and the page sometimes
"just not loading" until an unrelated edit). Restarting the whole backend
— including the live WhatsApp/Baileys connection — over a frontend CSS
tweak was also just needless churn even when it didn't race.

**Fixed** by decoupling the two entirely: `web/dist/` was dropped from
`--watch-path` (only `src/` changes restart the backend now), and
`serveDistFile()` resolves and reads each requested file from disk on
every request instead of caching anything at import time — a `GET /` or
`GET /assets/*` always reflects whatever's currently on disk, so a frontend
rebuild just takes effect on the next reload, no backend restart involved,
and there's no startup-time crash mode left (a missing/mid-rewrite file
just 404s or 500s that one request instead of taking down the process).
The read-per-request cost is a handful of small local files on a
loopback-only personal tool — not worth trading correctness for. Path
traversal (`/assets/../../..`) is stopped by resolving the path and
checking it still starts with `DIST_DIR`. `favicon.svg` (Vite's `public/`
output, served from `web/dist/` directly rather than `web/dist/assets/`)
goes through the same function for the same reason the JS/CSS bundle is
unauthenticated: no secret, and a `<link rel="icon">` can't attach the
token header either.

**Body text now uses a self-hosted variable font
(`@fontsource-variable/geist`, shadcn's Nova preset default) instead of the
system sans stack; headlines still use a system monospace stack, not a
webfont.** Only `--font-sans` was repointed at `'Geist Variable'` by
`shadcn init` — `--font-mono` (what `<h1>` uses via `font-mono`) was left
alone, so the "no webfont for the headline" decision above (originally
about the dropped serif font) still holds for `<h1>` specifically. Geist
itself is self-hosted, not a remote Google Fonts `<link>`, consistent with
that same reasoning: a control page for a real WhatsApp account shouldn't
make an unauthenticated third-party network request just to render text,
and `@fontsource`'s package ships the `.woff2` files straight into the Vite
build (see the previous paragraph), so there's no per-load dependency on
Google's CDN either way.

## Warning messages are generated, not a fixed string

The reply sent alongside a delete was originally a single hardcoded
`WARNING_MESSAGE` string, sent verbatim for every flagged message regardless
of what it actually said or how many strikes the contact already had. Two
problems with that: it can't reference the actual violation (reads as a
canned auto-reply, not a real consequence), and it says nothing about *why*
the message disappeared or that a system — not the account owner — is
watching and will act again.

**Chosen: generate the warning text per violation via the same local Ollama
model the classifier already uses** (`src/classifier/warning-message.ts`,
`generateWarningMessage`), given the classification's `category`/`reason`
and the contact's current strike count, and explicitly instructed to (1) name
the actual behavior to stop, (2) state plainly that this is an automated
moderation system, not the account owner personally, and (3) say that
continuing gets the contact blocked. **Transparency was a deliberate
requirement, not an oversight to fix later**: the contact is always told a
system is enforcing this, never left to think they're arguing with a person
who just isn't replying.

**Same fail-open contract as `classifyMessage`, deliberately not "fail open
= skip the warning."** An unreachable Ollama, a timeout, or an empty/
malformed response returns `{ ok: false }`, and `moderation-pipeline.ts`
falls back to the original static `WARNING_MESSAGE` env var (renamed
`FALLBACK_WARNING_MESSAGE` internally, same env var name for deployments
already setting it) rather than sending nothing. The message was already
deleted by this point — leaving the contact with no explanation at all is a
worse failure mode than a generic one, so the fallback path exists
specifically to avoid that, not as an afterthought.

**Sanitized before sending, not trusted verbatim.** A small local model asked
for "a short message" still sometimes wraps it in quotes, adds a preamble, or
rambles past a couple of sentences — `sanitize()` strips wrapping quotes,
collapses whitespace/newlines to a single line, and hard-truncates to
`WARNING_MAX_LENGTH` (default 320 chars) with a trailing ellipsis. This is a
safety ceiling on what actually reaches a real person's phone, not a target
length the prompt is expected to hit exactly.

**Configurable independently of the classifier's model**, via `WARNING_MODEL`
(falls back to `OLLAMA_MODEL` if unset; both share `OLLAMA_HOST`) and its own
`WARNING_TIMEOUT_MS`/`WARNING_TEMPERATURE`/`WARNING_MAX_LENGTH` —
classification and generation are different tasks (structured JSON verdict
vs. free-text phrasing) and may end up wanting different models even though
they share a default today.

## Activity panel: stats + a cross-contact message explorer

The control app previously had no way to see moderation activity except by
opening SQLite directly — no counts, no way to browse what had actually been
flagged/deleted/warned-about, per-contact or across the whole roster. Added
a "Moderation activity" sheet (`web/src/components/ActivityPanel.tsx`),
reachable from a header button (global) or a contact's new "Message
history" row (pre-filtered to that contact) — backed by two new read-only
endpoints on `src/web/control-server.ts`: `GET /api/stats` and
`GET /api/audit-log`.

**`getAuditLogPage` (src/store/audit-log.ts) is a new, separate query from
`getAuditLog`**, not a generalization of it: `getAuditLog(contactId, limit)`
is the pipeline's own history-seeding read (always one contact, always
newest-`created_at`-first, no filters) and stays exactly as it was: changing
its contract to support the explorer's filters/cursor would touch a
classifier-history code path for a feature that has nothing to do with it.
`getAuditLogPage` cursors on `id`, not `created_at` — `id` is monotonic with
insertion order and never ties the way two rows in the same millisecond
can, which matters once "load more" is a real button a person clicks
repeatedly rather than a one-shot fixed limit.

**Stats are a single all-time, all-contact aggregate** (`getAuditLogStats`),
not scoped by whatever contact the explorer happens to be filtered to —
opening the panel for one contact still shows the whole roster's numbers at
the top, with only the table below scoped to that contact. Splitting stats
into "global" vs "per-contact" views was considered and dropped: the
roster is small (one operator, a handful of monitored contacts), so a
second stats mode would be more UI than the data justifies.

**The API maps every snake_case DB column to camelCase**
(`auditLogEntry()` in control-server.ts), matching every other endpoint's
existing convention (`escalationEnabled`, `strikeCount`, etc.) — the
frontend never sees `classification_ok` or `contact_id`.

**`auditLog`/`blocks` are injected dependencies on `createControlServer`,
not direct store imports**, matching how `monitoredContacts`/
`contactDirectory`/`manualOverride` already work — `control-server.test.ts`
exercises the new routes against in-memory fakes, never a real SQLite file,
consistent with every other route in that suite.

**The sheet is remounted on every open via a `key` that increments each
time**, not just toggled open/closed — the same pattern
`ContactDetailPanel` already uses (`key={selectedContact?.id}`) to reset
local state on a new selection without a dedicated reset effect. This
matters here specifically because opening the same contact's history twice
in a row needs to reset scroll position and re-fetch, not just re-show
stale state; a plain `open`/`initialContactId` prop pair without the key
would need extra effects to detect "same contact, opened again" and those
effects are exactly the kind of subtle state-sync bug the key trick avoids
by construction.

**A real bug caught by browser-testing the built app, not by unit tests:
rapid filter changes could let an older request's response overwrite a
newer one.** `useActivityData` fires a fetch on every `contactId`/`action`
change (search is debounced, see below) — nothing stopped an in-flight
request from an earlier filter combination from resolving after a later
one and clobbering its result. Fixed with a monotonic request counter
(`requestSeq` in `web/src/lib/useActivityData.ts`): every fetch-initiating
call bumps it and captures its own value, and a response is only applied if
that value still matches when it resolves. `search` itself is debounced
(300ms) before it's applied to a fetch at all, purely so fast typing doesn't
fire a request per keystroke — orthogonal to the ordering bug above, which
the counter guards regardless of debouncing.

**Another real bug, also only visible by actually rendering the built
app at a real (short) viewport height, not by reading the JSX: a nested
`flex-1 min-h-0 overflow-y-auto` region inside another `flex-1 min-h-0
overflow-y-auto` region does not give the inner region its own scrollbar
the way it looks like it should.** The original layout gave both the
sheet's outer content wrapper and the message table's own container this
pairing, intending "the table scrols internally when there's room, and the
outer wrapper is a fallback scroll for very short viewports." In practice,
`min-h-0` on the inner flex item just lets flexbox shrink it to satisfy the
outer's height before ever triggering the outer's own overflow — on a
mobile-height viewport this crushed the table down to a sliver (measured at
79px tall) instead of either region ever scrolling correctly. Fixed by
removing the inner region's `flex-1`/`min-h-0`/`overflow-y-auto` entirely:
there is exactly one scroll region now (the sheet's outer content wrapper),
holding stats, filters, and the full table together — the table's own
horizontal scroll (from shadcn's `Table` component's built-in
`overflow-x-auto` wrapper) is unaffected and still handles narrow
viewports for the 4-column row content. A `sticky` table header was tried
and dropped for the same reason: `Table`'s wrapper div sets
`overflow-x-auto`, which per the CSS overflow spec also computes
`overflow-y` to `auto` (a non-`visible` value on one axis forces the other
off `visible` too) — that wrapper becomes the nearest containing block for
`position: sticky`, and since that wrapper itself never scrolls (the real
scrolling happens on its ancestor), the header would never actually stick.
Kept simple rather than fighting the framework: no sticky header, one clear
scroll region.

**Category labels are formatted for display only** (`formatCategory` in
`web/src/lib/activity.ts` swaps `_` for a space, e.g. `unwanted_contact` ->
`unwanted contact`) — the classifier's raw snake_case category strings are
never sent back to the API or altered in the database, only reformatted at
render time in `StatsCards`/`MessageExplorer`.

## Activity panel design pass, caught by an independent vision review

After the panel above shipped, a second design review (an Opus-model agent
given the built app in a browser, not the source) was run deliberately —
the person asked for a vision-capable model on this because layout/contrast
problems are exactly the kind of thing that reads fine in JSX but not on
screen. It found several real problems, distinct from the two functional
bugs recorded above:

**Two more real bugs**, not just taste calls:
- **The mobile Activity sheet was back to 75% width.** `SheetContent`'s
  `data-[side=right]:w-3/4` beat a plain `w-full` on specificity, the same
  class of bug the `sm:max-w-2xl!` fix above already worked around for the
  max-width — missed here because `w-full` looked unrelated to that fix.
  Fixed by making it `w-full!` too.
- **The sheet title went stale.** It read the contact name from the
  `initialContactId` prop (fixed at mount, by the remount-key design), so
  switching the contact *filter* to "All contacts" left the title still
  saying "Activity — Bob Chen". Fixed by dropping the per-contact title
  entirely — the filter row already shows what's selected, and the stats
  above it are explicitly whole-roster regardless of the table's filter
  (see the "single all-time, all-contact aggregate" note above), so a
  per-contact title was implying a scope the panel never actually had.

**Color was carrying the wrong meaning.** Red (`destructive`) had been used
for "Currently blocked", "Flagged & deleted", and the category bars — all
three are the system working exactly as designed, not failures. Meanwhile
"Classifier error" (an actual failure) rendered as a neutral outline badge.
Re-scoped red to the two states that are genuinely something going wrong
(`classifier_error`, `action_failed`); "Deleted" is now the `default`
(solid, high-emphasis but not alarm-colored) badge variant, since it's
often the single most important row and deserves visual weight without
implying an error; category bars use `bg-foreground/60`, not destructive.

**A table-auto-layout gotcha, only visible once mobile actually had only
two columns to show.** Hiding `When`/`Contact` below `sm` (to fix the
sheet-width bug above from also fixing the *content*) didn't fix the
underlying squeeze: the browser's default table layout sizes columns by
content's preferred width, and a `max-w-xs` on a cell is only a hint that
loses to a long unwrapped badge label (`"Classifier error"`) — the table's
`scrollWidth` still exceeded its container, so the fix for the crushed
mobile table upstream had just been replaced by a *different* mobile table
that still needed horizontal scroll to read a message. Fixed with
`table-fixed` plus an explicit width on every column but `Message`, which
makes the header row (not content) the sole source of truth for column
widths — confirmed by checking the table container's `scrollWidth` equals
its `clientWidth` after the fix, not just eyeballing a screenshot.

**Direction icons were redundant, not just unlabeled.** The "From" column
paired a contact name with an arrow icon to show whether a row was received
from the contact or sent by the system — but `direction` is fully
determined by `action` already (only `warning_sent` is ever `'me'`;
everything else is `'them'`), and the `ActionBadge` column already carries
that distinction. Dropped the icons and the column rename to "Contact"
removes the redundant signal rather than just relabeling it.

**Not changed, despite being flagged:** hiding the Paused/Escalation card
for an unmonitored contact, and replacing the roster row's Ban-icon toggle
with a `Switch`. Both would reverse an explicit, previously-litigated
decision (see "Control panel: full contact list + slide-in detail panel"
above: "Panel controls are always rendered, never hidden... An empty-
looking panel read as broken") rather than fix a regression this round of
work introduced — revisit deliberately if it comes up again, not as a
side effect of an unrelated review.

## Auto dark mode, no in-app toggle

`shadcn init` had already generated a full `.dark` OKLCH palette in
`web/src/index.css` (Nova preset default), but nothing ever added the
`dark` class anything reads — dark mode was unreachable dead CSS. Fixed
with `web/src/lib/theme.ts`'s `initSystemTheme()`, called once from
`main.tsx` before the first render: reads
`matchMedia('(prefers-color-scheme: dark)')` once at startup and again on
every change, toggling the `dark` class on `<html>`. No settings toggle in
the UI — this is a personal, single-operator tool, and following the
OS/browser preference (live, if it changes mid-session) covers the actual
need without adding a persisted preference or a settings surface to hold
one.

## `auth_info/` is a credential

The `auth_info/` folder holds Signal protocol session keys equivalent to
full account access on the linked WhatsApp account. Treat it exactly like a
credential: gitignored (never commit it, even by accident), and encrypt at
rest on the host if practical.

## Contact-panel choreography, resizable panels, and the overview KPI row

**Motion, not more hand-written CSS transitions.** The contact-detail
panel's open/close sequence needed two strictly ordered stages (move+resize
the list pane, *then* fade the detail panel in at a fixed position — and
the reverse on close), which the previous hand-tuned CSS
`transition:`-with-a-guessed-delay (see "Control panel: full contact list +
slide-in detail panel" above) could only approximate: the delay was a
fixed guess at how long the width transition would take, not a real
"wait until it's actually done." Replaced with
[Motion](https://motion.dev) (`motion/react`), whose `animate` +
`onAnimationComplete` let the fade-in stage start only once the move stage
has *actually* finished, via a small `'closed' | 'opening' | 'open' |
'closing'` state machine in `App.tsx`. `@formkit/auto-animate` stays for
the contact list's reorder animation (`ContactList.tsx`) — different
problem (list diffing vs. orchestrated multi-stage layout), no reason to
replace it.

**The list pane now actually resizes, not just re-centers.** Previously,
opening a contact only changed the list pane's `margin-left` (25% → 0%);
its width stayed a constant 50% the whole time, so "browsing" was really
"the same 50%-wide pane, shifted to look centered" — no `width` ever
changed. The spec's two-stage choreography calls for the pane to move
*and* resize at once, so browsing width is now 60% (with a 20% margin
either side, keeping it visually centered) and narrows to 50% flush-left
once a contact opens — a genuine, if modest, resize alongside the move,
not just a relabeling of the old margin trick.

**`prefers-reduced-motion` bypasses the staged phases entirely**, not just
zeroes the transition duration — `App.tsx`'s phase-sync effect jumps
straight to the final `'open'`/`'closed'` state when
`useReducedMotion()` is true, so there's no dependency on an
`onAnimationComplete` firing (or not) for a zero-duration animation to
know when it's "done." The mid-transition panel (partially resized,
still invisible) is also `inert` + `aria-hidden` until the phase is fully
`'open'` — previously neither the CSS-transition version nor its
`lg:opacity-0`/`lg:w-0` closed state ever excluded the panel from the tab
order, so a keyboard user could already tab into off-screen/invisible
detail content; worth fixing now that "partially open but invisible" is a
real, longer-lived intermediate state rather than an instant CSS jump.

**Resizable panels are pixel widths in `sessionStorage`, not a
split-pane library.** Considered `react-resizable-panels`, but every
"panel" here is a single overlay with one resizable edge (a `Sheet` or the
fixed-position contact-detail pane), not a multi-pane split layout — a
generic split-pane library would bring a whole layout model this app
doesn't have. Built `useResizableWidth` (`web/src/lib/`) instead: a
small hook exposing a controlled pixel width, an ARIA `role="separator"`
handle (pointer drag + arrow-key/Home/End keyboard resize + double-click
reset), and `sessionStorage` persistence keyed per panel id, clamped to
the current viewport on load and on resize. `ResizeHandle`
(`web/src/components/`) is the shared visual/`aria-*` wrapper; each of the
four panels (contact-detail, Activity, Policy, Settings) gets its own
storage key so resizing one never affects another. Below `sm` (640px),
sheets skip resizing entirely and stay the existing full-width mobile
overlay — there's no slack to resize into at that width.

The contact-detail panel is a special case: during the open/close
choreography its width is Motion-driven (a percentage, synced with the
list pane); the resize handle only takes over once the panel is fully
`'open'`, switching the animated `width` to the hook's controlled pixel
value. The hook's `defaultWidth` is seeded from half the *current*
viewport width at mount (clamped to its min/max) specifically so that
handoff from "50%-of-viewport" to "a fixed pixel width" doesn't visibly
jump.

## A compact overview KPI row on the main contact view

Added `OverviewStats` (`web/src/components/`, backed by a standalone
`useOverviewStats` hook in `web/src/lib/useStats.ts`), showing Monitored /
Blocked / Deleted / Errors between the header and the contact search
field. Deliberately a separate hook from `useActivityData`'s stats
fetch rather than a shared one: this row needs to fetch and live-update
(via the same `/api/events` `audit-log` SSE trigger) whether or not the
Activity panel is even mounted, and `useActivityData` is remounted via a
`key` every time the Activity panel opens (by design, so filters reset) —
tying the always-visible overview row to that lifecycle would mean
refetching stats it already has every time the operator opens Activity.
The small duplication (both hooks fetch `/api/stats` the same way) is
cheaper than the coupling.

## Real WhatsApp profile photos: lazy, bounded, proxied

Picks up the photo feature "Control panel: full contact list + slide-in
detail panel" above deliberately deferred. The avatar isolation it set up
held: the frontend change is one `AvatarImage` inside `ContactAvatar.tsx`,
plus an optional `photoUrl` on `Contact`. Radix's `Avatar` only swaps the
image in once it has actually loaded, so any 404 or broken image leaves
the initials in place without extra handling.

**Lookups are lazy, on a request for that contact's photo — never eager on
connect.** `GET /api/contacts` does no WhatsApp I/O. It only adds each
contact's `photoUrl`: a same-origin path, `/api/contacts/:id/photo?v=<fetchedAt>`,
or `null` once a fresh lookup has confirmed there's no photo, so the
frontend skips asking. `GET /api/contacts/:id/photo` is what triggers
`profilePictureUrl(jid, 'preview')` (`src/whatsapp/profile-photos.ts`). An
eager sweep over a 200+ contact list on every connect would put a burst of
IQ queries on the linked-device socket for photos nobody may ever look at,
the same kind of unusual traffic "The block/unblock cycle is itself a ban
signal" is wary of.

**Every lookup, whatever triggered it, goes through one process-wide
concurrency limiter capped at 3** (`PHOTO_LOOKUP_CONCURRENCY`, a small
hand-rolled FIFO queue in `src/whatsapp/concurrency-limiter.ts`; a
dependency wasn't worth it for ~20 lines). Concurrent requests for the same
contact share one in-flight lookup. CDN downloads get their own limiter
(4): they don't touch the socket, but they still shouldn't fan out to one
request per contact at once. The trade-off is first-load latency: the
avatars of a never-seen list fill in gradually, not all at once. That's
acceptable because the result is cached.

**The cache is two columns on `contacts`, `photo_url` and
`photo_fetched_at`, added with the same one-off `pragma_table_info` +
`ALTER TABLE` pattern as `last_message_at`/`lid`.** The contacts table is
real user data, so a schema change can't recreate it. Results, including
"no photo", stay fresh for 24h (`PHOTO_REFRESH_MS`). That mostly bounds how
stale a signed CDN URL can get, because an actual photo change arrives
sooner: Baileys turns WhatsApp's `picture` notification into a
`contacts.update` with `imgUrl: 'changed' | 'removed'`, and the directory
clears that contact's `photo_fetched_at` on it. A CDN URL that expires
early anyway (403/404/410 on download) triggers exactly one forced
re-lookup, never a loop.

**It fails open, like the classifier.** A missing photo isn't an error:
`undefined`, or Baileys' `item-not-found`/`not-authorized` IQ errors
(thrown as a `Boom` with the code in `.data`). It's cached as "no photo".
A real failure is returned as `{ ok: false }` and never thrown: a
disconnected socket, a timeout (15s, well under Baileys' 60s default, so a
stalled query can't pin a limiter slot), or a CDN error. It's logged via
`pino`, left uncached, and backed off for 15 minutes so a flaky contact
doesn't re-query WhatsApp on every page load. The route answers a failure
with the same plain 404 as "no photo". Either way the frontend's only move
is falling back to initials, and a 5xx would just add console noise.

**The route is a least-privilege proxy.** It's behind the same
`verifyTailscaleIdentity` check as every other `/api/*` route, not the
static-asset exceptions. The server fetches the image bytes itself and
returns only those: the signed CDN URL and WhatsApp's response headers
never reach the browser. Before fetching, it checks that the URL is https
on `*.whatsapp.net` and sets `redirect: 'error'`. The URL comes from
WhatsApp, but this server fetches it with its own network access (next to
a loopback-only Ollama), so it isn't trusted as an arbitrary URL. The
response must be JPEG/PNG/WebP (never SVG, which could carry script once
re-served from this authenticated origin) and at most 1 MiB, and it goes
out with `nosniff` and `Cache-Control: private, max-age=3600`. It only looks
up individual JIDs already in the contact directory, so it can't be used
to probe photos for arbitrary numbers.
