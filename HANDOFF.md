# Handoff: WhatsApp content moderation bot

Written for whoever (human or agent) picks this up next, most likely running
locally to get past a cloud-environment network restriction. Context below.

## What this project is

A personal, single-contact "digital curtain" for WhatsApp: link to one
WhatsApp account as a companion device, run incoming messages from one
specific contact through an LLM classifier, delete flagged messages locally
("delete for me"), send a warning, and temporarily block the contact after
N consecutive strikes, auto-unblocking after a timer.

## Where things stand

Design phase is done; implementation hasn't started beyond a validation
prototype. Everything so far is in **PR #1** (draft):
https://github.com/BSoDium/WhatsApp-content-moderation/pull/1
on branch `claude/elegant-allen-k9quqh`.

### Design review outcome (decided in chat, not written up elsewhere — captured here)

The original brief was solid but had gaps. Key changes made to the design:

1. **Biggest open risk, unresolved**: whether Baileys' `deleteForMe` app-state
   sync action actually removes an incoming message from the linked phone.
   This is the one assumption the whole project depends on and it has not
   been empirically confirmed yet — see "Immediate next step" below.
2. **Ban risk** is bigger than "keep request frequency low" — the
   block → wait → auto-unblock cycle is itself a distinctive automation
   signature to Meta's abuse detection, separate from raw request volume.
   User explicitly chose to keep automated timed unblock as originally
   planned (not the safer manual-unblock alternative), so the scheduler
   should add random jitter to the check/unblock timing rather than firing
   on exact intervals, as a partial mitigation.
3. **Library choice**: Baileys over whatsapp-web.js — no headless-browser
   (Puppeteer) overhead, lighter footprint for an always-on host, better
   multi-device protocol support.
4. **Classifier**: use structured JSON output (not free-text Pass/Fail),
   include recent conversation context (not just the isolated message),
   fail-open on LLM API errors (never silently delete/block on a
   classification that didn't actually happen), and build a **shadow mode**
   first — log classification decisions for a while without acting on them,
   to catch false positives before they cost you a real message.
5. **State/logging**: SQLite for strikes + block records (`unblockAt`
   timestamps) + a full audit log of every message and its classification —
   this log is the only record once a message is actually deleted from
   WhatsApp.
6. **Media messages** (images/voice notes) are out of scope for now — text
   only. Decide explicitly later whether to add multimodal classification.
7. **Manual override channel**: nice-to-have, not yet built — a way to send
   yourself commands (`!pause`, `!unblock`, `!status`) from your own
   "message yourself" chat so you can intervene without shelling into the
   host.
8. **Hosting**: self-host on the user's spare hardware (already decided,
   not cloud) — zero cost, no inbound ports needed (outbound WS + outbound
   LLM API calls only), full control over the Signal session keys. Docker
   with `restart: always`, auth folder on a persisted + backed-up volume.
9. **Auth state security**: the `auth_info/` folder holds Signal protocol
   session keys equivalent to full account access — treat it like a
   credential. It's gitignored; never commit it, encrypt at rest if
   possible.

### What's built

- `package.json` — Baileys (`@whiskeysockets/baileys`), `pino`,
  `qrcode-terminal`, `@hapi/boom`. `npm install` has been verified to work.
- `src/prototype/test-delete-for-me.js` — throwaway validation script.
  Links as a companion device (prints a QR to scan), waits for a text
  message from a test contact, and ~3s later calls
  `sock.chatModify({ deleteForMe: { key, timestamp, deleteMedia } }, jid)`,
  logging success/failure. This is **not** part of the eventual production
  bot — it exists purely to answer the open risk in point 1 above.
- `.gitignore` — excludes `auth_info/` and future local DB/env files.
- `README.md` — current status + planned architecture summary.

## Immediate next step (blocking everything else)

Run the prototype and physically confirm on a phone whether the delete
propagates:

```
npm install
npm run prototype:delete-for-me
```

Scan the printed QR with WhatsApp → Linked Devices. Then, from a **second**
WhatsApp number, send the linked account a text message. The script waits
~3 seconds and attempts the delete — check the primary phone: did the
message actually disappear?

This could not be completed in the cloud session that did the design work —
that environment's network policy returned 403 on outbound connections to
`web.whatsapp.com` and `g.whatsapp.net` (Baileys needs a raw WSS tunnel,
which that sandbox's proxy didn't allow through). Running locally sidesteps
that entirely.

**If the delete does not propagate reliably**, stop and reconsider the
architecture before building anything further — the "digital curtain"
premise depends on it. Fallback ideas to consider in that case: archiving
instead of deleting, or accepting that some exposure window is unavoidable
and designing the warning/strike flow around that instead.

## What's next after that's confirmed

In rough build order:

1. LLM classifier module — structured JSON output, conversation context,
   fail-open, plus a shadow-mode flag to log-only before enabling real
   deletion/blocking.
2. SQLite schema: strikes (per contact, with decay on `Pass`), block
   records with `unblockAt`, full message/classification audit log.
3. Message debounce/buffer for multi-message bursts (5–10s window) before
   classification, using recent context rather than classifying each
   message in total isolation.
4. Strike → warning-reply → delete-for-me pipeline, wired to the real
   classifier instead of the prototype's unconditional delete.
5. Block/unblock flow: native `block`/`unblock` API calls, jittered
   scheduler for expiry checks, idempotency guard against duplicate
   block calls if events queue up during a state transition.
6. Manual override channel (optional, see point 7 above).
7. Docker packaging + systemd/compose service for the spare-machine
   deployment, with the auth folder on a backed-up volume.

## Open PR

PR #1 (draft) is being watched by the cloud session that created it — it
has a recurring hourly check-in scheduled against it for CI/review status.
That's independent of where implementation work happens; push commits to
`claude/elegant-allen-k9quqh` as normal and that session will pick up CI
results and any review comments on its own.
