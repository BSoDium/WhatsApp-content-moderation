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

test('an unknown language has no template', () => {
  assert.equal(templateWarning('Swahili', 'message', 2), null);
});
