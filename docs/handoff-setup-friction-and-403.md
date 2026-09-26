# Handoff: setup friction and control-app 403

## User report

The user completed the documented Debian setup and then received a `403
forbidden` from the control app. They say the host and client are on the same
tailnet, the client is logged in as their own `@github` identity, and they
entered that identity in the host configuration. Do not ask them to paste
`CONTROL_SERVER_TOKEN` or a URL containing it.

The user also says the install flow is too tedious for a beginner: too many
manual steps and too much room for mistakes. They want a clean, conventional,
user-friendly setup. They intend to hand this off for further work.

## Current install and first-run flow

PR #35 has been merged into `main`. The supported recipe is a source checkout
that builds locally; Compose does not pull the separately published GHCR
release image.

1. Install or verify Debian x86-64, Docker Compose, and Tailscale; sign the
   host into the tailnet.
2. Clone the repo; copy `.env.example` and `config/policy.example.md` to
   their private counterparts.
3. Create `auth_info/` and `data/`, restrict permissions, and chown those
   paths plus `config/policy.md` to UID 1000 for the container.
4. Edit `.env`: set port 4756, the exact Tailscale login, and a generated
   control token. Write a real moderation policy. Shadow mode defaults on.
5. Run `docker compose up -d --build`; pull `llama3.2:3b` into Ollama; tail
   the app logs.
6. Scan the WhatsApp QR code to pair the companion device.
7. Configure host Tailscale Serve with `sudo tailscale serve --bg 4756`.
   Open its HTTPS hostname with the control token query parameter.
8. Add a contact, review shadow-mode logs, and only then set
   `SHADOW_MODE=0` and recreate the app with `docker compose up -d app`.

Routine source updates are `git pull --ff-only` followed by
`docker compose up -d --build app`. The current guide is in the README's
"Debian install and updates" section.

## Why the flow is error-prone

- Setup crosses several tools and contexts: Git, file permissions, editing
  secrets and personal policy, Docker Compose, model download, WhatsApp QR
  pairing, Tailscale Serve, and browser token bootstrap.
- The operator must know which values to copy exactly and which paths must
  remain private and writable/readable by container UID 1000.
- The app does not currently run a guided preflight that verifies Compose,
  the model, bind-mount permissions, the loopback port, and the live Serve
  identity header before asking the user to pair WhatsApp.
- The first-time browser link contains a credential in its query string;
  that token must not be pasted into logs, chat, or shared notes.
- Docker host networking is intentional: the app binds to loopback so host
  Tailscale Serve can reach it. Ollama is published on host loopback only.
  Any setup simplification must preserve these boundaries and the
  persistent `auth_info/`, `data/`, and policy mounts.

## 403 investigation notes

The app can return the same JSON `{"error":"forbidden"}` for either of two
failed checks in `src/web/control-server.ts`:

1. `verifyTailscaleIdentity` reads `Tailscale-User-Login` and compares it to
   `ALLOWED_TAILSCALE_LOGIN` using exact, case-sensitive string equality.
   There is no normalization.
2. If identity matches, the request also needs the control token. The first
   `GET /` accepts the query token or a previously set cookie; API calls use
   the token header/query path. A cookie alone is deliberately not accepted
   for `/api/*`.

The app logs which check rejected the request:

- `rejected: no matching Tailscale identity` logs the received login header
  (or `null` if absent), but never the control token.
- `rejected: missing or invalid control token` means the identity check
  passed but the token did not.

Live `tailscale serve` identity forwarding had not been validated when the
README was written. Treat a mismatch between the reported login and the
actual header as a hypothesis until confirmed from the app log and
`tailscale serve status`. Do not weaken the allow-list or remove token auth
just to make the 403 disappear. Do not log or request the token.

## Suggested next-agent work

1. Ask the user for the exact 403 context (initial page vs. an API action)
   and the relevant app log rejection line, with secrets redacted.
2. Confirm `tailscale serve status` targets local port 4756 and inspect the
   actual `Tailscale-User-Login` value seen by the app. Compare it with the
   configured login, including capitalization and provider suffix.
3. If identity passes, check whether the bootstrap URL had the correct
   token and whether the browser retained the token cookie/local storage.
   Have the user regenerate the token only if it was exposed or is known to
   be wrong; never ask them to disclose it.
4. After resolving the 403, propose a minimal guided setup/preflight that
   reduces manual edits and validates dependencies before WhatsApp pairing.
   Keep the existing simple Docker Compose update path and security
   invariants unless the user chooses a different deployment model.
