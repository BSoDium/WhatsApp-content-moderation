# WhatsApp-content-moderation

A localised, background-hosted "digital curtain" for a personal WhatsApp account. It links to the account as a headless companion device (via [Baileys](https://github.com/WhiskeySockets/Baileys)), runs incoming messages from one specific contact through an LLM classifier, deletes flagged messages locally ("delete for me"), sends a warning, and temporarily blocks the contact after repeated strikes.

## Status

**`deleteForMe` validated (2026-09-24).** Linked a real WhatsApp account as a
companion device via the prototype below and confirmed that Baileys'
`chatModify({ deleteForMe: ... })` app-state patch actually removes a message
from the primary phone — the one assumption the whole "digital curtain"
premise depended on.

**Classifier module built (2026-09-24).** Ollama-backed, structured JSON
output, fail-open. See "Classifier" below. Next up: SQLite state (strikes +
block records + audit log), message debounce, and the strike/block/unblock
pipeline that actually wires the classifier to `deleteForMe`.

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

- `llama3.2:1b` was tried first (cheapest, best fit for CPU-only decade-old
  hardware) but was unreliable: under JSON-schema-constrained output it would
  write a correct `category`/`reason` (e.g. "insult" / "contains threats
  directed at me") and then still set `flagged: false`, contradicting its own
  reasoning. `llama3.2:3b` got every hand-tested case right and stayed
  internally consistent, so it's the default (`OLLAMA_MODEL` to override) —
  worth re-verifying carefully with `classifier:test` before dropping back to
  1b on weaker hardware.
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

The classifier's model choice (see below) was picked with the ThinkCentre's
CPU-only, 2-core/8GB profile in mind, but hasn't yet been benchmarked for
actual per-message latency on that specific hardware — only functionally
verified on a much faster dev machine. Before relying on this for real
moderation, run `npm run classifier:test` on the target machine itself and
confirm the response time is acceptable; the delete/warn flow already has
some slack built in (see `DELETE_DELAY_MS` in the prototype), but a
multi-minute classification would still be too slow to be useful.

## Planned architecture

- **Transport**: Baileys (no headless browser, lighter than whatsapp-web.js)
- **Classifier**: LLM call per message (structured JSON output, not free-text), with conversation context, fail-open on API errors
- **State**: SQLite — strike counts, block records with `unblockAt`, full audit log of messages + classifications (the only record once a message is deleted)
- **Scheduler**: periodic check for expired blocks, jittered rather than fixed-interval
- **Deployment**: self-hosted on the reference hardware above, Docker with `restart: always`, auth state on a persisted + backed-up volume
