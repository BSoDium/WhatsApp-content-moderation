import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTailscaleIdentity } from './tailscale-identity.ts';

function reqWithHeaders(headers) {
  return { headers };
}

test('reads login, name, picture and tailnet from Serve headers', () => {
  const identity = readTailscaleIdentity(
    reqWithHeaders({
      'tailscale-user-login': 'alice@example.com',
      'tailscale-user-name': 'Alice Architect',
      'tailscale-user-profile-pic': 'https://example.com/alice.png',
      'x-forwarded-host': 'whatsapp-moderation.tail1234.ts.net',
    }),
  );
  assert.deepEqual(identity, {
    login: 'alice@example.com',
    name: 'Alice Architect',
    pictureUrl: 'https://example.com/alice.png',
    tailnet: 'tail1234.ts.net',
  });
});

test('decodes Q-encoded and B-encoded non-ASCII names', () => {
  const q = readTailscaleIdentity(reqWithHeaders({ 'tailscale-user-login': 'a@b.c', 'tailscale-user-name': '=?utf-8?q?=C3=89lodie_Negrel?=' }));
  assert.equal(q?.name, 'Élodie Negrel');
  const b = readTailscaleIdentity(reqWithHeaders({ 'tailscale-user-login': 'a@b.c', 'tailscale-user-name': `=?utf-8?b?${Buffer.from('Éli').toString('base64')}?=` }));
  assert.equal(b?.name, 'Éli');
});

test('falls back to the login when the display name is missing', () => {
  assert.equal(readTailscaleIdentity(reqWithHeaders({ 'tailscale-user-login': 'alice@example.com' }))?.name, 'alice@example.com');
});

test('drops a non-https or malformed picture URL', () => {
  for (const pic of ['http://example.com/a.png', 'javascript:alert(1)', 'not a url']) {
    assert.equal(readTailscaleIdentity(reqWithHeaders({ 'tailscale-user-login': 'a@b.c', 'tailscale-user-profile-pic': pic }))?.pictureUrl, null);
  }
});

test('tailnet is null for a non-ts.net host and tolerates a port', () => {
  assert.equal(readTailscaleIdentity(reqWithHeaders({ 'tailscale-user-login': 'a@b.c', 'x-forwarded-host': 'localhost:4756' }))?.tailnet, null);
  assert.equal(readTailscaleIdentity(reqWithHeaders({ 'tailscale-user-login': 'a@b.c', 'x-forwarded-host': 'svc.tail1234.ts.net:443' }))?.tailnet, 'tail1234.ts.net');
});

test('returns null without a login header', () => {
  assert.equal(readTailscaleIdentity(reqWithHeaders({})), null);
});
