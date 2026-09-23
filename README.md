# WhatsApp-content-moderation

A localised, background-hosted "digital curtain" for a personal WhatsApp account. It links to the account as a headless companion device (via [Baileys](https://github.com/WhiskeySockets/Baileys)), runs incoming messages from one specific contact through an LLM classifier, deletes flagged messages locally ("delete for me"), sends a warning, and temporarily blocks the contact after repeated strikes.

## Status

Design phase. Before building the strike/block/unblock logic, we're validating the one assumption everything else depends on: that Baileys' `deleteForMe` app-state sync action reliably removes an incoming message from the linked phone.

## Validating "delete for me"

This has to be run interactively on the machine you intend to self-host on, since it requires scanning a QR code with your phone.

```
npm install
npm run prototype:delete-for-me
```

Then, from a second WhatsApp account, send a text message to the linked account. The script waits a few seconds, calls `chatModify({ deleteForMe: ... })`, and logs the result — check your phone to confirm the message actually disappeared.

If this doesn't hold up reliably, the deletion strategy needs to change before anything else gets built on top of it.

## Planned architecture

- **Transport**: Baileys (no headless browser, lighter than whatsapp-web.js)
- **Classifier**: LLM call per message (structured JSON output, not free-text), with conversation context, fail-open on API errors
- **State**: SQLite — strike counts, block records with `unblockAt`, full audit log of messages + classifications (the only record once a message is deleted)
- **Scheduler**: periodic check for expired blocks, jittered rather than fixed-interval
- **Deployment**: self-hosted on a spare machine, Docker with `restart: always`, auth state on a persisted + backed-up volume
