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

Send yourself commands (`!pause`, `!resume`, `!unblock`, `!status`) from
your own "Message yourself" chat, to intervene without shelling into the
host machine — see `src/override/override-channel.js`.

- **Gating mirrors the moderated-contact side, inverted.** `extractIncomingMessage`
  (see `src/pipeline/incoming-message.js`) accepts messages from the target
  contact and rejects our own; `extractOverrideMessage` does the opposite —
  only `fromMe: true` messages in the chat whose `remoteJid` is the
  account's own JID. An override is by definition something only the
  account owner can send.
- **`!pause`/`!resume` state is in-memory only**, reset on restart. A
  restart already means someone is actively working on the host, so there's
  no scenario where losing the pause flag surprises anyone — persisting a
  flag whose whole purpose is a temporary human override would be the
  actual surprise.
- **Pausing skips the pipeline entirely** rather than routing through
  shadow mode: no classification, no audit-log entry, nothing pushed to the
  buffer. `!status` still works while paused since it reads the strike/block
  stores directly, not the buffer.
- **`!unblock` bypasses the jittered schedule but reuses its exact
  unblock-then-mark-resolved ordering** (`src/pipeline/unblock-scheduler.js`'s
  `runTick`): call `actions.unblock` first, only mark the local block record
  resolved if that succeeds. A failed WhatsApp call must leave the block
  record active for a later retry (manual or scheduled), not silently
  "succeed" locally while the contact stays blocked on WhatsApp.

## `auth_info/` is a credential

The `auth_info/` folder holds Signal protocol session keys equivalent to
full account access on the linked WhatsApp account. Treat it exactly like a
credential: gitignored (never commit it, even by accident), and encrypt at
rest on the host if practical.
