# Roadmap

Rough build order for the strike/block/unblock pipeline. Update this file
as steps complete or the plan changes — it's the living version of what
used to be a one-off handoff note.

1. ~~LLM classifier module~~ — **done**. Structured JSON output, conversation
   context, fail-open (see `src/classifier/`, README "Classifier"). Still
   missing: a shadow-mode flag on the eventual pipeline (step 4) to log
   classifications without acting on them — the classifier module itself
   doesn't know about shadow mode, that's a pipeline concern.
2. SQLite schema: strikes (per contact, with decay on `Pass`), block
   records with `unblockAt`, full message/classification audit log (see
   `docs/decisions.md#state--audit-log-via-sqlite`).
3. Message debounce/buffer for multi-message bursts (5–10s window) before
   classification, using recent context rather than classifying each
   message in total isolation.
4. Strike → warning-reply → delete-for-me pipeline, wired to the real
   classifier instead of the prototype's unconditional delete. This is
   where `history` gets populated for `classifyMessage`, and where shadow
   mode actually lives (classify + log, skip the delete/warn/strike calls).
5. Block/unblock flow: native `block`/`unblock` API calls, jittered
   scheduler for expiry checks (see
   `docs/decisions.md#the-blockunblock-cycle-is-itself-a-ban-signal`),
   idempotency guard against duplicate block calls if events queue up
   during a state transition.
6. Manual override channel (optional — see
   `docs/decisions.md#manual-override-channel-not-yet-built`).
7. Docker packaging + systemd/compose service for the reference-hardware
   deployment (see README "Reference hardware"), with the auth folder on a
   backed-up volume.

## Before trusting this with a real contact

- Replace the placeholder `config/policy.md` with the real policy.
- Re-run `npm run classifier:test` against known cases on the actual
  self-host machine, not just a dev machine — see README "Reference
  hardware" for why this matters and isn't just a formality.
- Ship shadow mode first (step 1/4 above) and watch its log for false
  positives before enabling real deletion/blocking.
