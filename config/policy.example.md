# Moderation policy

This file is read verbatim and given to the classifier as the definition of
what to flag. Copy it to `policy.md` (gitignored — never committed, since it
describes a real person and situation) and fill it in with your own
specifics before running anything against a real contact.

Write it as plain instructions to the classifier, in as much detail as you're
comfortable with. Concrete examples of what should and shouldn't be flagged
help far more than abstract rules — a small model follows examples much more
reliably than adjectives like "abusive".

Suggested shape (delete/rewrite freely — this is a starting point, not a
required structure):

## Flag messages that

- (e.g. contain insults, threats, or demeaning language directed at me)
- (e.g. pressure or guilt-trip me into responding or meeting up)
- (e.g. reference topics I've asked this contact not to bring up: ...)

## Do not flag messages that

- (e.g. are neutral, unrelated small talk)
- (e.g. are frustrated but not directed at me personally)
- (e.g. — borderline cases you'd rather the classifier let through than
  over-flag)

## Examples

- "example flagged message" -> flagged, because ...
- "example fine message" -> not flagged, because ...

## Notes for the classifier

- When in doubt, do not flag — a false negative costs nothing extra (the
  strike system tolerates a few missed messages); a false positive deletes
  a message from a real person's phone and may unfairly escalate a strike.
