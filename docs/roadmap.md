# Roadmap

The build order for the strike/block/unblock pipeline is tracked as GitHub
issues (#5–#10), all on the account-level
[`Open-source development`](https://github.com/users/BSoDium/projects/5)
board — see `AGENTS.md`'s "GitHub project board" section. This file is a
one-time snapshot of that order for context, **not** the place to update as
work progresses; the issues are. A stale snapshot here is fine, since it's
clearly labeled as one — a stale to-do list pretending to be current is what
got `HANDOFF.md` retired in the first place.

1. ~~LLM classifier module~~ — **done**. Structured JSON output, conversation
   context, fail-open (see `src/classifier/`, README "Classifier"). Shadow
   mode (log without acting) is folded into #7, since the classifier module
   itself doesn't know about shadow mode — that's a pipeline concern.
2. [#5](https://github.com/BSoDium/WhatsApp-content-moderation/issues/5) —
   SQLite schema: strikes, block records, audit log.
3. [#6](https://github.com/BSoDium/WhatsApp-content-moderation/issues/6) —
   Message debounce/buffer before classification.
4. [#7](https://github.com/BSoDium/WhatsApp-content-moderation/issues/7) —
   Strike → warning-reply → delete-for-me pipeline (includes shadow mode).
5. [#8](https://github.com/BSoDium/WhatsApp-content-moderation/issues/8) —
   Block/unblock flow with jittered scheduler.
6. ~~[#9](https://github.com/BSoDium/WhatsApp-content-moderation/issues/9)~~ —
   **done**. Manual override channel (optional). See `src/override/`,
   README "Manual override channel", and `docs/decisions.md`.
7. [#10](https://github.com/BSoDium/WhatsApp-content-moderation/issues/10) —
   Docker packaging for the reference-hardware deployment.

## Before trusting this with a real contact

- Replace the placeholder `config/policy.md` with the real policy.
- Re-run `npm run classifier:test` against known cases on the actual
  self-host machine, not just a dev machine — see README "Reference
  hardware" for why this matters and isn't just a formality.
- Ship shadow mode first (#7) and watch its log for false positives before
  enabling real deletion/blocking.
