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

## State & audit log via SQLite

Strike counts (per contact, decaying on a `Pass` classification), block
records (with `unblockAt` timestamps for the jittered scheduler above), and
a full log of every message plus its classification, all in SQLite. The
audit log matters more than it sounds: once a message is actually deleted
via `deleteForMe`, that log is the *only* remaining record of what it said
and why it was acted on. This is also why `AGENTS.md`'s error-handling rule
insists on logging classifier failures, not just successes — the log needs
to be trustworthy in both directions.

## Media messages are out of scope for now

Images and voice notes aren't classified — text only, for now. Revisit
explicitly if/when multimodal classification is worth the added complexity
and (for a CPU-only host) the added inference cost; don't silently expand
scope to cover media without deciding this again first.

## Manual override channel (not yet built)

A nice-to-have: send yourself commands (`!pause`, `!unblock`, `!status`)
from your own "Message yourself" chat, so you can intervene without
shelling into the host machine. Not built yet — the strike/block pipeline
(see `docs/roadmap.md`) needs to exist first before there's anything to
override.

## `auth_info/` is a credential

The `auth_info/` folder holds Signal protocol session keys equivalent to
full account access on the linked WhatsApp account. Treat it exactly like a
credential: gitignored (never commit it, even by accident), and encrypt at
rest on the host if practical.
