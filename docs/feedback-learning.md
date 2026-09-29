# Spec: learning moderation rules from labelled messages

Status: proposal, nothing built.

## Problem

The classifier only follows concrete rules (see README "Writing rules the classifier can follow"). Writing one is hard: the operator knows a message is unacceptable when they see it, but not which words or topics define the rule, and they can't tell whether a rewrite helps without waiting for real traffic.

## Goal

Let the operator label real messages in their conversation context, and have the assistant propose the rule that separates the two piles. The operator approves it after seeing how it would have judged every labelled message.

## Flow

1. **Label.** In the Activity panel each row gets "acceptable" / "not acceptable" actions and an optional note ("this is guilt-tripping"). Opening a row shows the surrounding conversation.
2. **Suggest.** From a contact's panel (per-contact context) or the Policy editor (global policy), "Suggest rule from labels" sends the labelled examples, their context, notes, and the current rule text to a proposer model. It returns a candidate rule in the concrete style the classifier follows, plus a one-line rationale.
3. **Backtest.** Before anything is shown as accepted, the candidate is run through the real classifier over every labelled message and the last N audit-log rows for that contact. The operator sees: labelled messages now judged correctly / incorrectly, and unlabelled messages whose verdict would flip.
4. **Accept.** Accepting writes the candidate to the contact context or global policy through the existing setters. Rejecting, or editing the text first, changes nothing else.

## Data

New `feedback_labels` table (Drizzle migration, per the `drizzle/` rule in AGENTS.md):

| column | notes |
| --- | --- |
| `id` | integer primary key |
| `audit_log_id` | the labelled message; the audit log is the only record once a message is deleted |
| `contact_id` | denormalised for per-contact queries |
| `verdict` | `acceptable` or `unacceptable` |
| `note` | optional free text |
| `created_at` | epoch ms |

Labels are separate from `audit_log.flagged`, which stays what the classifier decided at the time.

## API

- `POST /api/feedback`, `DELETE /api/feedback/:id`, `GET /api/feedback?contact=`
- `POST /api/rules/suggest` with `{ scope: 'global' | contactId }`, returning `{ candidate, rationale, backtest }`. Never persists anything.

## Constraints

- **Fail open.** A failed or malformed suggestion returns `{ ok: false }` and leaves every rule untouched; only the operator's explicit accept changes rules. The backtest is mandatory, not optional.
- **Proposer model.** Runs on demand, not per message, so it can be a larger and slower model than the classifier (`RULE_PROPOSER_MODEL`, default: inherit the classifier model), with its own timeout. Local Ollama by default, since labelled messages are private conversation text; anything remote would be opt-in and called out in the UI.
- **Context is thin today.** History comes from the audit log, which holds only messages received while a contact was monitored plus automated warnings. The operator's own replies are not stored, so "full context" means either logging outgoing messages Baileys already delivers (fromMe) or accepting one-sided context. Decide this before building step 1.
- **Prompt injection.** Labelled messages are untrusted text fed to the proposer; the prompt must frame them as data, and the backtest is the guard against a candidate that a message talked the model into.

## Later

- Use labels as few-shot examples in the classifier prompt, or as training data for an embedding-based classifier (see "Classifier options" below).
- Turn labels into the regression set behind `npm run classifier:test`, so a model or prompt change can be scored against real cases.

## Classifier options

Today the classifier is a general instruction-following LLM (`llama3.2:3b` through Ollama) reading free-text rules. Alternatives, and why they fit or don't:

| Option | Fits free-text per-contact rules? | Notes |
| --- | --- | --- |
| Larger instruction LLM (7-8B class) | Yes | Same architecture, follows abstract rules far better; costs CPU latency and RAM. |
| Guard models (Llama Guard, ShieldGemma) | No | Trained on a fixed harm taxonomy (violence, hate, ...). Can't take "flag anything about my mother". |
| Fixed-label classifiers (toxicity BERTs) | No | Good for "is this an insult", blind to per-contact rules and to guilt-tripping. |
| Zero-shot NLI encoder (multilingual DeBERTa) | Partly | Takes a rule as a hypothesis, small and fast, but weak on nuanced rules and context. |
| Embeddings + small trained classifier | Only with labels | Fast, cheap, multilingual; needs the labelled examples this spec collects. Per-contact rules become per-contact training data. |

Recommendation: keep an LLM for rule-following, and revisit an embedding classifier once enough labels exist to evaluate it against the LLM on the same regression set.
