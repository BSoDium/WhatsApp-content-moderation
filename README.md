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
output, fail-open. See "Classifier" below.

**Live pipeline wired up (2026-09-26).** `deleteForMe`, `sendWarning`, and
block/unblock all confirmed working end-to-end against real WhatsApp
accounts (see "Validating..." sections below), and `index.js` wires
strike → warn → delete into a live connection.

**Block/unblock scheduler built and validated (2026-09-26).** Issue #8:
strikes crossing `STRIKE_THRESHOLD` trigger a block, `src/pipeline/
unblock-scheduler.js` polls and auto-unblocks once the jittered duration
passes — see "Block/unblock scheduler" below and
[`docs/decisions.md`](docs/decisions.md) for the design. Confirmed live in
two parts: self-chat (strike/delete/warn, plus the block attempt correctly
failing against your own account — WhatsApp doesn't allow self-blocking)
and a real second account (block and scheduled auto-unblock both fired for
real, no manual step). A self-review afterward caught and fixed a real
crash risk (an uncaught DB error in the scheduler's poll loop could have
taken down the whole process) and a case where a successful block with a
failed local write would leave a contact blocked with no record to ever
auto-unblock — see the PR #21 history for detail, not repeated here.

**Not yet ready to run against a real contact.** `config/policy.md` is
still the example placeholder — see docs/roadmap.md "Before trusting this
with a real contact" for the remaining checklist (real policy, shadow-mode
run first, etc.) before pointing this at anyone for real.

Remaining roadmap: [`docs/roadmap.md`](docs/roadmap.md).

## Running it

Not yet run against a real account — see issue #15. Requires `config/policy.md` filled in (see "Classifier" below), Ollama running, and `TARGET_CONTACT_JID` set to the one contact this should moderate:

```
npm install
TARGET_CONTACT_JID=15551234567@s.whatsapp.net npm start
```

First run needs the QR code scanned interactively, same as the prototypes below — `index.js` reuses `auth_info/`, so it picks up an existing link from `prototype:delete-for-me` if you've already run that. Every other incoming message from `TARGET_CONTACT_JID` gets buffered, classified, and acted on for real (delete-for-me + warning + strike on a flag); everything else is ignored. `SHADOW_MODE=1` classifies and logs without acting, for watching it against real traffic first.

No second number handy? Set `TEST_ALLOW_SELF=1` and point `TARGET_CONTACT_JID` at your own JID — same idea as `prototype:delete-for-me`'s flag of the same name — to validate the live pipeline against messages you send yourself:

```
TARGET_CONTACT_JID=15551234567@s.whatsapp.net TEST_ALLOW_SELF=1 SHADOW_MODE=1 npm start
```

Your own "Message yourself" chat isn't always addressed by your phone-number JID — some accounts route it through the newer `@lid` form instead (e.g. `110599736393979@lid`). If messages you send yourself never reach the pipeline under `TEST_ALLOW_SELF`, check the actual `remoteJid` Baileys reports (log it once from `messages.upsert`) rather than assuming the phone-number form.

## Testing each layer in isolation

Sending real WhatsApp messages back and forth for every change is slow and, for block/unblock, requires a second WhatsApp account you may not have. Each layer below can be exercised on its own instead:

- **Automated tests** (pure logic + real SQLite, no WhatsApp, no Ollama — assertions, real pass/fail, no manual reading required): `npm test`
- **Classifier** (Ollama only, no WhatsApp): `npm run classifier:test`
- **Buffer** (pure timers, no WhatsApp, no Ollama): `npm run buffer:test`
- **Store** (SQLite, no WhatsApp): `npm run store:test`
- **Moderation pipeline** (classifier + buffer + store, `deleteForMe`/`sendWarning` stubbed to console output): `npm run pipeline:test`
- **WhatsApp actions** (`sendWarning` + `deleteForMe` against a real connection, classifier/buffer/pipeline bypassed entirely): `TARGET_CONTACT_JID=<a JID you can message, e.g. your own> npm run whatsapp:test-actions` — sends a throwaway message and immediately deletes it, so no second number or friend's participation is needed just to confirm these two primitives still work. Needs an `auth_info/` link that's had a few minutes to settle after first pairing (see the note under "Validating 'delete for me'" below); `App state key not present!` almost always means the app-state sync key hasn't arrived yet, not a bug in the call itself.
- **Block/unblock**: still needs a real second WhatsApp account's JID — see "Validating block/unblock" below. This is a WhatsApp-side restriction (you cannot block your own account), not something isolation can remove, but the second account only needs to exist, not actively participate.

Only the full live pipeline (`npm start`) and block/unblock genuinely require a live WhatsApp round-trip; everything else above runs offline or against a stub.

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

`deleteForMe` (and any other `chatModify` app-state action — archive, pin,
etc.) needs an app-state sync key that WhatsApp pushes to a companion
device shortly after it's linked. On a **freshly** linked `auth_info/`,
give the connection a few minutes to sit open and idle before relying on
`deleteForMe` — restarting the process repeatedly right after linking can
interrupt that handshake and leave it missing indefinitely. If `chatModify`
throws `App state key not present!` well after linking, log out the device
from WhatsApp → Linked Devices and relink cleanly rather than retrying in
place.

## Validating block/unblock

Confirmed working against a real second WhatsApp account — see issue #16.
Same interactive requirement as above, plus a real second WhatsApp number:
you can't block your own "Message yourself" chat, so there's no self-test
fallback here.

```
npm install
BLOCK_TEST_JID=15551234567@s.whatsapp.net npm run prototype:block-unblock
```

The script blocks the target via `updateBlockStatus`, confirms it with
`fetchBlocklist()`, waits a few seconds, then unblocks and confirms again.
Check your phone directly too: does the contact actually show as blocked,
then unblocked? This needs to pass before #8 builds a scheduler on top of
it.

`fetchBlocklist()` can return a stale snapshot for a few seconds right
after a socket connects or right after a block/unblock call — a fresh
`updateBlockStatus` call may not show up in the very next `fetchBlocklist()`
even though it already took effect (confirmed via the phone's own "You
blocked/unblocked this person" system messages, which are the reliable
signal). The script retries a few times before reporting either step as
failed; if it still can't confirm after that, trust the phone over the
console.

## Block/unblock scheduler

Wired into the live pipeline (`npm start`) — see
[`docs/decisions.md`](docs/decisions.md#trigger-duration-and-jitter-issue-8-design)
for the full design. A contact gets blocked the first time their strike
count reaches `STRIKE_THRESHOLD` (default **3**), and unblocked
automatically after `BLOCK_DURATION_MS` (default **24h**) ± `BLOCK_JITTER_MS`
(default **4h**), checked every `UNBLOCK_POLL_INTERVAL_MS` (default
**2 min**). All four are overridable via environment variable. `SHADOW_MODE`
skips blocking along with everything else it already skips.

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
