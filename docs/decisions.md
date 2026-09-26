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
`manual-override.js`'s constructor-bound target and global `paused` flag
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
(`escalation_enabled = 0`) still lets `moderation-pipeline.js` classify,
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
`moderation-pipeline.js` already keys off `msg.key.remoteJid`), and does not
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
  layout.
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

`src/web/control-server.ts` is the control surface #9 needed: a static
page plus a JSON API in front of `manual-override.js`'s per-contact
pause/resume/unblock routines, `contact-directory.js`'s known-contacts
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

## `auth_info/` is a credential

The `auth_info/` folder holds Signal protocol session keys equivalent to
full account access on the linked WhatsApp account. Treat it exactly like a
credential: gitignored (never commit it, even by accident), and encrypt at
rest on the host if practical.
