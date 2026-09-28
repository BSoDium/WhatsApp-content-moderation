# Agent guidance for this repo

Ported from the conventions used in this author's other projects (notably
`Cron`), adapted from Kotlin/Android to Node.js/ESM. Follow these on every
diff in this repo.

## Comments & files

- Default to writing no comment. Add one only when the *why* is non-obvious
  (a workaround for a specific bug, a hidden invariant, a constraint from an
  external system like Baileys or Ollama). Don't restate what the code does
  — clean names and whitespace explain far more than prose.
- No multi-line `//` comment blocks and no section-banner comments
  (`// ---- Foo ----`). They're a sign a file is doing too much — split into
  atomic files instead (one file, one responsibility), as `src/classifier/`
  already does (`classifier.ts`, `policy.ts`, `test-classifier.ts` are
  separate files rather than one grab-bag module).
- JSDoc is for exported functions whose contract isn't obvious from the
  signature alone (see `classifyMessage` in `src/classifier/classifier.ts`)
  — one block explaining behavior/failure modes, not a paragraph per param.
- Don't leave `// TODO` or hand-tuned magic numbers without a plan. Hoist
  constants to a top-level `const` with a name that explains the value
  (`DELETE_DELAY_MS`, `TIMEOUT_MS`), not an inline literal.

## Error handling

- Fail open on anything talking to an external system (Ollama, WhatsApp) —
  never let a failed classification silently become an action. See
  `classifyMessage`'s `{ ok: false }` contract in
  `src/classifier/classifier.ts`. Any new code that gates a
  delete/warn/block/unblock on a fallible call must follow the same shape: a
  result the caller has to check, not a thrown exception the caller might
  forget to catch, and never a guessed default that fails closed by
  accident.
- `try/catch` is for boundaries where failure is actually possible
  (network calls, filesystem, parsing external input) — don't wrap internal
  calls whose contract already guarantees success.
- Always log what failed and why (this project already depends on `pino`)
  — a silently swallowed error is a debugging trap, especially once a
  message has actually been deleted and the log is the only record left of
  what happened (see `docs/decisions.md`'s "State & audit log via SQLite").

## JavaScript / Node style

- ESM only (`"type": "module"` is already set) — never mix in `require`.
- `const` by default; `let` only for a genuinely reassigned local. No `var`.
- Named exports over default exports, so call sites read as
  `import { classifyMessage } from './classifier.ts'`, not a guessed name.
- Small, single-purpose functions. A module-local helper that isn't reused
  elsewhere stays unexported (`policy.ts`'s `cached` variable and its
  lazy-load guard are file-private, not exported).
- No bare magic numbers/strings inline — hoist to a top-level `const`,
  ideally sourced from `process.env` with a documented default when it's
  something a deployment might reasonably override (see `classifier.ts`'s
  `MODEL`, `TIMEOUT_MS`, `OLLAMA_HOST`).
- Prefer template literals over string concatenation.
- Async/await over raw `.then()` chains, except for small one-off
  `.then()/.catch()` pairs where introducing a whole function scope would
  be noisier (e.g. the QR-to-PNG side effect in the prototype script).

## Secrets & personal data

- Anything that's a credential or describes a real person never gets
  committed, even in an example/placeholder form that could leak details:
  `auth_info/` (WhatsApp session keys), `.env`, `*.sqlite*` (audit log,
  settings, and the moderation policy itself — see "Deployment invariants"
  below for why the policy lives here now, not in a tracked file).
- If a new local secret/config file is needed, follow that same pattern:
  commit a template if one's useful, and gitignore the real file by exact
  name (not a broad directory glob that could accidentally swallow
  something that should be tracked).
- Prefer a hardcoded default over a first-boot file import for anything
  configurable. Nothing in this app reads a config file on startup —
  everything is a settings-store default (`src/store/settings.ts`,
  `src/classifier/policy.ts`), editable live from the control app. Don't
  reintroduce a "seed from disk once" step; it's exactly the pattern this
  repo moved away from (see `docs/decisions.md`'s "Dropping `.env`,
  `config/policy.md`, and first-boot file imports").

## Deployment invariants

- `docker-compose.yml` is the whole deploy recipe — one file, no repo
  clone, no `.env`, no mounted config beyond `auth_info/` and `data/`. Don't
  add a file the operator has to create before `docker compose up -d`
  works; add a settings-store default instead.
- `network_mode: host` in `docker-compose.yml` is load-bearing for two
  things at once: it's what lets `src/web/control-server.ts` bind every
  interface directly on the host (the default, LAN-open mode) with no
  `ports:` mapping, and it's what lets host Tailscale Serve proxy the
  loopback-only bind `ALLOWED_TAILSCALE_LOGIN` switches to. Don't move this
  to bridge networking without re-deriving both of those — bridge gives the
  container a different loopback/interface set entirely, and would also
  break `OLLAMA_HOST`'s default (`http://127.0.0.1:11434`, which only
  resolves under host networking).
- With host networking, the app reaches the Compose Ollama service through
  `127.0.0.1:11434`. Publish Ollama on host loopback only; do not expose its
  port to the LAN.
- The app image needs the built `web/dist` bundle. Keep the frontend build
  stage and copy in `Dockerfile` in sync with `src/web/control-server.ts`.
- The app image needs the `drizzle/` migrations folder at runtime, not just
  build time — `src/store/db.ts` resolves it relative to its own file, so a
  missing `COPY drizzle ./drizzle` in `Dockerfile` fails at startup, not
  build. Regenerate it (`npx drizzle-kit generate`) and commit the result
  whenever `src/store/schema.ts` changes; don't hand-edit anything under
  `drizzle/`.
- The runtime container drops from root to UID 1000 (`node`) via
  `docker-entrypoint.sh`, which also `chown -R`s `auth_info/`/`data/` first
  — this is what makes a bind mount Docker creates (owned by root) usable
  by the app with no host-side `chown`. Keep this entrypoint in sync with
  any new bind-mounted path; don't reintroduce a host-side ownership step.
- Keep first-run defaults (shadow mode, the moderation policy) safe. The
  90-second classifier timeout accommodates the documented CPU-only target;
  lower it only after measuring inference on that hardware.

## Workflow

- Concise responses. No celebration paragraphs, no end-of-turn "here's what
  I did" recap that just restates the diff.
- **Branch before touching any file.** Never commit directly to `main`.
  Name branches with the standard prefixes: `feat/`, `fix/`, `chore/`,
  `docs/`, `style/`, `refactor/`, matching the commit-message convention
  below.
- **Commit incrementally** at each logical milestone rather than staging
  everything into one commit at the end.
- **Conventional commit messages**: `type(scope): summary` as the subject
  (scope optional, omit if the change doesn't cleanly belong to one area),
  a blank line, then a body explaining *why* the change was made and what
  it affects — not a restatement of the diff. Multi-part changes can use a
  `* type(scope): sub-summary` bullet per logical piece.
- **Push and open a draft PR once implementation is complete.** Don't wait
  for the user to ask. Promote to "ready for review" only on explicit user
  confirmation — never unilaterally.
- Don't run destructive git operations (`reset --hard`, force-push, branch
  deletion) without explicit user approval.
- When a PR closes an issue, link it with a GitHub closing keyword
  (`Closes #N`, `Fixes #N`) in the PR body. Use `Part of #N` / `Refs #N`
  when it advances an issue without fully resolving it.

## GitHub project board

This is an account-level board — `Open-source development` (project #5,
owner `BSoDium`) — shared across all of this author's repos, not something
scoped to this project alone. It tracks issues/PRs from every repo owned by
`BSoDium`, this one included.

**This requires `gh` CLI (or direct GitHub GraphQL API) access — check
before assuming it's there.** Projects v2 board membership and its fields
are not something the standard GitHub MCP server tool set can read or
write at all (no "add item to project", no "set project field"), so an
agent restricted to those tools — including Claude Code's cloud/remote
sessions — cannot do this even in principle, no matter how carefully these
steps are followed. Don't silently skip it if that's the situation you're
in: use the fallback below instead, so the gap is visible rather than
quietly compounding.

- **If you have `gh`/GraphQL access**: every new issue must be added to the
  board immediately after creation: `gh project item-add 5 --owner BSoDium
  --url <issue-url>`. Then set four fields via `gh api graphql`:
  - **Status** — `Backlog` for new work
  - **Priority** — `P0`–`P4`, relative to existing issues on the board
  - **Size** — `XS`/`S`/`M`/`L`/`XL`, by effort
  - **Category** — `Feature`, `Bug`, `Refactor`, `Config`, or
    `Documentation`, based on the issue's nature

  Fetch current field and option IDs from the project API
  (`gh project field-list 5 --owner BSoDium`) — don't hardcode them, they
  can change. Also apply relevant GitHub labels (e.g. `bug`, `enhancement`)
  at creation time.

  **Only orphan PRs go on the board.** If a PR closes an issue via a
  closing keyword and that issue is already on the board, do **not** also
  add the PR — the issue already tracks it, and adding both creates
  duplicate noise. Only PRs with no closing keyword (nothing they close) go
  on the board themselves, with the same Status/Priority/Size/Category
  fields set. Apply relevant GitHub labels to every PR regardless of
  whether it ends up on the board.

- **If you don't have that access**: still apply the relevant GitHub
  labels, then leave a one-line note on the issue, or on the PR itself if
  it's an orphan (nothing it closes) — e.g. "Needs board triage:
  Status=Backlog, Priority=?, Size=?, Category=?" — instead of skipping it
  silently. That note is what lets board membership be batched later,
  rather than the board just falling behind with no record of what's
  missing from it.
