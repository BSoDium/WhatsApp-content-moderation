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

1. **Biggest open risk — RESOLVED (2026-09-24)**: whether Baileys' `deleteForMe`
   app-state sync action actually removes an incoming message from the linked
   phone. Confirmed empirically: linked a real account, sent a test message
   (via `TEST_ALLOW_SELF=1` against a "Message yourself" chat, since no
   second number was available at test time), and the message visibly
   disappeared from the phone a few seconds after `chatModify({ deleteForMe:
   ... })` ran. The "digital curtain" premise holds.
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
4. **Classifier — BUILT (2026-09-24)**: structured JSON output (not
   free-text Pass/Fail), includes recent conversation context, fails open on
   LLM errors (never silently delete/block on a classification that didn't
   actually happen). Runs on a local Ollama model — zero API cost, fits the
   self-hosted/CPU-only constraint. `llama3.2:1b` was tried first but proved
   unreliable (see `src/classifier/classifier.js` and README "Classifier"
   section for the exact failure and fix); `llama3.2:3b` is the default.
   Shadow mode (log-only, no action) still needs to be built — that's part
   of wiring the classifier into the actual pipeline (build-order step 4
   below).
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
- `.gitignore` — excludes `auth_info/` and future local DB/env files, plus
  `config/policy.md` (the real moderation policy — personal, never committed).
- `README.md` — current status + planned architecture summary.
- `src/classifier/classifier.js` — `classifyMessage({ message, history })`,
  calls a local Ollama model with a JSON-schema-constrained response
  (`category`, `reason`, `flagged` — in that order, deliberately, so the
  model reasons before committing to the verdict). Fails open (`{ ok: false
  }`) on any error; callers must never delete/block on that.
- `src/classifier/policy.js` — loads `config/policy.md`, throwing a clear
  error pointing at `config/policy.example.md` if it's missing/empty.
- `config/policy.example.md` — committed template for the moderation policy.
  `config/policy.md` (gitignored) is the real one — user fills it in.
- `src/classifier/test-classifier.js` (`npm run classifier:test`) — REPL to
  try the classifier against typed messages without a WhatsApp connection.

## Immediate next step — DONE

~~Run the prototype and physically confirm on a phone whether the delete
propagates~~ — done, see "Design review outcome" point 1 above. (This could
not be completed in the cloud session that did the design work — that
environment's network policy returned 403 on outbound connections to
`web.whatsapp.com` and `g.whatsapp.net`, since Baileys needs a raw WSS
tunnel that sandbox's proxy didn't allow through. Running locally sidestepped
that entirely.)

## What's next now that's confirmed

In rough build order:

1. ~~LLM classifier module~~ — **done**, see "What's built" above. Still
   need a shadow-mode flag on the eventual pipeline (step 4) to log-only
   before enabling real deletion/blocking — the module itself doesn't know
   about shadow mode, that's a pipeline concern.
2. SQLite schema: strikes (per contact, with decay on `Pass`), block
   records with `unblockAt`, full message/classification audit log.
3. Message debounce/buffer for multi-message bursts (5–10s window) before
   classification, using recent context rather than classifying each
   message in total isolation.
4. Strike → warning-reply → delete-for-me pipeline, wired to the real
   classifier instead of the prototype's unconditional delete. This is
   where `history` gets populated for `classifyMessage` and where shadow
   mode actually lives (classify + log, skip the delete/warn/strike calls).
5. Block/unblock flow: native `block`/`unblock` API calls, jittered
   scheduler for expiry checks, idempotency guard against duplicate
   block calls if events queue up during a state transition.
6. Manual override channel (optional, see point 7 above).
7. Docker packaging + systemd/compose service for the spare-machine
   deployment, with the auth folder on a backed-up volume.

### Note on the target machine

The classifier was built and tested on this dev machine with Ollama
installed via Homebrew (`brew install ollama`, `ollama serve` in the
background, `ollama pull llama3.2:3b`). None of that is installed on the
actual self-host target yet — whoever deploys this needs to repeat that
setup there, and re-run `npm run classifier:test` against a few known cases
to confirm the model behaves the same way before trusting it with a real
contact.

## Open PR

PR #1 (draft) is being watched by the cloud session that created it — it
has a recurring hourly check-in scheduled against it for CI/review status.
That's independent of where implementation work happens; push commits to
`claude/elegant-allen-k9quqh` as normal and that session will pick up CI
results and any review comments on its own.
