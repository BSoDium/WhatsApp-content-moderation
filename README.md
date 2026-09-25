# WhatsApp-content-moderation

A localised, background-hosted "digital curtain" for a personal WhatsApp account. It links to the account as a headless companion device (via [Baileys](https://github.com/WhiskeySockets/Baileys)), runs incoming messages from one specific contact through an LLM classifier, deletes flagged messages locally ("delete for me"), sends a warning, and temporarily blocks the contact after repeated strikes.

## Status

**`deleteForMe` validated (2026-09-24).** Linked a real WhatsApp account as a
companion device via the prototype below and confirmed that Baileys'
`chatModify({ deleteForMe: ... })` app-state patch actually removes a message
from the primary phone — the one assumption the whole "digital curtain"
premise depended on. (Ran with `TEST_ALLOW_SELF=1` against a "Message
yourself" chat, since no second WhatsApp number was available at the time —
see the note on that flag below.)

**Classifier module built (2026-09-24).** Ollama-backed, structured JSON
output, fail-open. See "Classifier" below. Next up: SQLite state (strikes +
block records + audit log), message debounce, and the strike/block/unblock
pipeline that actually wires the classifier to `deleteForMe` — see
[`docs/roadmap.md`](docs/roadmap.md) for the full build order and
[`docs/decisions.md`](docs/decisions.md) for the "why" behind design choices
not covered elsewhere in this README.

## Running it

Not yet run against a real account — see issue #15. Requires `config/policy.md` filled in (see "Classifier" below), Ollama running, and `TARGET_CONTACT_JID` set to the one contact this should moderate:

```
npm install
TARGET_CONTACT_JID=15551234567@s.whatsapp.net npm start
```

First run needs the QR code scanned interactively, same as the prototypes below — `index.js` reuses `auth_info/`, so it picks up an existing link from `prototype:delete-for-me` if you've already run that. Every other incoming message from `TARGET_CONTACT_JID` gets buffered, classified, and acted on for real (delete-for-me + warning + strike on a flag); everything else is ignored. `SHADOW_MODE=1` classifies and logs without acting, for watching it against real traffic first.

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
