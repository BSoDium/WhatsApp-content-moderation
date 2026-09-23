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
  already does (`classifier.js`, `policy.js`, `test-classifier.js` are
  separate files rather than one grab-bag module).
- JSDoc is for exported functions whose contract isn't obvious from the
  signature alone (see `classifyMessage` in `src/classifier/classifier.js`)
  — one block explaining behavior/failure modes, not a paragraph per param.
- Don't leave `// TODO` or hand-tuned magic numbers without a plan. Hoist
  constants to a top-level `const` with a name that explains the value
  (`DELETE_DELAY_MS`, `TIMEOUT_MS`), not an inline literal.

## Error handling

- Fail open on anything talking to an external system (Ollama, WhatsApp) —
  never let a failed classification silently become an action. See
  `classifyMessage`'s `{ ok: false }` contract and HANDOFF.md's design
  review point 4. Any new code that gates a delete/warn/block/unblock on a
  fallible call must follow the same shape: a result the caller has to
  check, not a thrown exception the caller might forget to catch, and never
  a guessed default that fails closed by accident.
- `try/catch` is for boundaries where failure is actually possible
  (network calls, filesystem, parsing external input) — don't wrap internal
  calls whose contract already guarantees success.
- Always log what failed and why (this project already depends on `pino`)
  — a silently swallowed error is a debugging trap, especially once a
  message has actually been deleted and the log is the only record left of
  what happened (see HANDOFF.md point 5).

## JavaScript / Node style

- ESM only (`"type": "module"` is already set) — never mix in `require`.
- `const` by default; `let` only for a genuinely reassigned local. No `var`.
- Named exports over default exports, so call sites read as
  `import { classifyMessage } from './classifier.js'`, not a guessed name.
- Small, single-purpose functions. A module-local helper that isn't reused
  elsewhere stays unexported (`policy.js`'s `cached` variable and its
  lazy-load guard are file-private, not exported).
- No bare magic numbers/strings inline — hoist to a top-level `const`,
  ideally sourced from `process.env` with a documented default when it's
  something a deployment might reasonably override (see `classifier.js`'s
  `MODEL`, `TIMEOUT_MS`, `OLLAMA_HOST`).
- Prefer template literals over string concatenation.
- Async/await over raw `.then()` chains, except for small one-off
  `.then()/.catch()` pairs where introducing a whole function scope would
  be noisier (e.g. the QR-to-PNG side effect in the prototype script).

## Secrets & personal data

- Anything that's a credential or describes a real person never gets
  committed, even in an example/placeholder form that could leak details:
  `auth_info/` (WhatsApp session keys), `config/policy.md` (the real
  moderation policy), `.env`, `*.sqlite*` (once the audit log exists).
  Ship a `*.example.*` template instead and gitignore the real file
  specifically — see `.gitignore` and `config/policy.example.md`.
- If a new local secret/config file is needed, follow that same pattern:
  commit a template, gitignore the real file by exact name (not a broad
  directory glob that could accidentally swallow something that should be
  tracked).

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
