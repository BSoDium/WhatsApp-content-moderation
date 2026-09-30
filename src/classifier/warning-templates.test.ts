import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateWarning } from './warning-templates.ts';

const TEMPLATED = ['English', 'French', 'Spanish', 'Polish'];
const MAX_TEMPLATE_LENGTH = 260;

test('every templated language covers every consequence for both kinds, in one short text with no placeholder left over', () => {
  for (const language of TEMPLATED) {
    for (const kind of ['message', 'call'] as const) {
      for (const remaining of [3, 2, 1, 0]) {
        const text = templateWarning(language, kind, remaining);
        assert.ok(text, `${language}/${kind}/${remaining}`);
        assert.ok(text.length <= MAX_TEMPLATE_LENGTH, `${language}/${kind}/${remaining} is ${text.length} characters`);
        assert.doesNotMatch(text, /undefined|\$\{|\{\w+\}/);
      }
    }
  }
});

test('the remaining count appears only when more than one offence remains', () => {
  for (const language of TEMPLATED) {
    assert.match(templateWarning(language, 'message', 4)!, /\b4\b/);
    assert.doesNotMatch(templateWarning(language, 'message', 1)!, /\d/);
    assert.doesNotMatch(templateWarning(language, 'message', 0)!, /\d/);
  }
});

test('never uses the word strike or calls the conversation a group', () => {
  for (const language of TEMPLATED) {
    for (const remaining of [3, 1, 0]) assert.doesNotMatch(templateWarning(language, 'message', remaining)!, /strike|frappe|group/i);
  }
});

test('French and Spanish stay in the formal register and out of gendered forms', () => {
  const french = templateWarning('French', 'message', 2)!;
  assert.match(french, /\b(votre|vos)\b/i);
  assert.doesNotMatch(french, /\b(ton|ta|tes|tu)\b|bloqué/i);

  const spanish = templateWarning('Spanish', 'message', 2)!;
  assert.match(spanish, /\bSu\b/);
  assert.doesNotMatch(spanish, /\b(tu|tus|eres|deja)\b|bloqueado/i);
});

test('an unknown language has no template', () => {
  assert.equal(templateWarning('Swahili', 'message', 2), null);
});

test('the final warning says the block is happening only when one follows', () => {
  for (const language of TEMPLATED) {
    for (const kind of ['message', 'call'] as const) {
      const blocked = templateWarning(language, kind, 0, true)!;
      const open = templateWarning(language, kind, 0, false)!;
      assert.notEqual(blocked, open, `${language}/${kind}`);
      assert.doesNotMatch(blocked, /\d|strike|frappe|group/i);
      assert.equal(templateWarning(language, kind, 1, true), templateWarning(language, kind, 1, false));
    }
  }
  assert.match(templateWarning('French', 'message', 0, true)!, /désormais appliqué/);
  assert.doesNotMatch(templateWarning('French', 'message', 0, true)!, /bloqué|à tout moment/);
});
