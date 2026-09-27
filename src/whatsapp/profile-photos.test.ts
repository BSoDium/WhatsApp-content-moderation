import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { Boom } from '@hapi/boom';

process.env.DB_PATH = 'data/test-profile-photos.test.sqlite';

const { createProfilePhotos, PHOTO_LOOKUP_CONCURRENCY, PHOTO_REFRESH_MS } = await import('./profile-photos.ts');
const { getPhotoCache } = await import('../store/contact-photos.ts');
const { getDb } = await import('../store/db.ts');

const ALICE = '15550000001@s.whatsapp.net';
const BOB = '15550000002@s.whatsapp.net';
const START = 1_700_000_000_000;
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function cdnUrl(jid, version = 1) {
  return `https://pps.whatsapp.net/v/t61/${jid.split('@')[0]}.jpg?oe=${version}`;
}

function seedContacts(...ids) {
  const insert = getDb().prepare('INSERT INTO contacts (contact_id, updated_at) VALUES (?, ?)');
  for (const id of ids) insert.run(id, START);
}

function fakeSocket(lookup = (jid) => cdnUrl(jid)) {
  const calls = [];
  return {
    calls,
    profilePictureUrl: async (jid, type, timeoutMs) => {
      calls.push({ jid, type, timeoutMs });
      return lookup(jid);
    },
  };
}

function imageResponse(bytes = JPEG_BYTES, contentType = 'image/jpeg') {
  return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
}

function fakeFetch(respond = () => imageResponse()) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return respond(url);
  };
  return Object.assign(impl, { calls });
}

function setup({ lookup, respond, connected = true } = {}) {
  const clock = { now: START };
  const sock = fakeSocket(lookup);
  const fetchImpl = fakeFetch(respond);
  const photos = createProfilePhotos({ getSocket: () => (connected ? sock : undefined), fetchImpl, now: () => clock.now });
  return { photos, sock, fetchImpl, clock };
}

beforeEach(() => {
  getDb().exec('DELETE FROM contacts');
});

after(() => {
  for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
});

test('a contact with a photo: looks it up once, caches the URL, and returns the proxied bytes', async () => {
  seedContacts(ALICE);
  const { photos, sock, fetchImpl } = setup();

  const result = await photos.getPhoto(ALICE);

  assert.deepEqual(result, { ok: true, photo: { body: JPEG_BYTES, contentType: 'image/jpeg' } });
  assert.deepEqual(sock.calls, [{ jid: ALICE, type: 'preview', timeoutMs: 15_000 }]);
  assert.deepEqual(fetchImpl.calls, [cdnUrl(ALICE)]);
  assert.deepEqual(getPhotoCache(ALICE), { url: cdnUrl(ALICE), fetchedAt: START });
  assert.equal(photos.photoPath(ALICE), `/api/contacts/${encodeURIComponent(ALICE)}/photo?v=${START}`);
});

test('photoPath never exposes the cached CDN URL', async () => {
  seedContacts(ALICE);
  const { photos } = setup();
  await photos.getPhoto(ALICE);

  const path = photos.photoPath(ALICE);
  assert.match(path, /^\/api\/contacts\//);
  assert.doesNotMatch(path, /pps\.whatsapp\.net|oe=/);
});

test('a never-looked-up contact gets an unversioned photo path so the frontend asks for it', () => {
  seedContacts(ALICE);
  const { photos } = setup();

  assert.equal(photos.photoPath(ALICE), `/api/contacts/${encodeURIComponent(ALICE)}/photo`);
});

test('a contact with no photo (Baileys returns undefined) falls back cleanly and caches the absence', async () => {
  seedContacts(ALICE);
  const { photos, sock, fetchImpl } = setup({ lookup: () => undefined });

  assert.deepEqual(await photos.getPhoto(ALICE), { ok: true, photo: null });
  assert.deepEqual(await photos.getPhoto(ALICE), { ok: true, photo: null });

  assert.equal(sock.calls.length, 1);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(photos.photoPath(ALICE), null);
});

test("Baileys' item-not-found / not-authorized IQ errors mean no photo, not a failure", async () => {
  seedContacts(ALICE, BOB);
  const { photos } = setup({
    lookup: (jid) => {
      throw new Boom(jid === ALICE ? 'item-not-found' : 'not-authorized', { data: jid === ALICE ? 404 : 401 });
    },
  });

  assert.deepEqual(await photos.getPhoto(ALICE), { ok: true, photo: null });
  assert.deepEqual(await photos.getPhoto(BOB), { ok: true, photo: null });
  assert.equal(getPhotoCache(ALICE).fetchedAt, START);
});

test('a failed lookup fails open without throwing, and does not disturb other contacts', async () => {
  seedContacts(ALICE, BOB);
  const { photos } = setup({
    lookup: (jid) => {
      if (jid === ALICE) throw new Error('socket timed out');
      return cdnUrl(jid);
    },
  });

  const [alice, bob] = await Promise.all([photos.getPhoto(ALICE), photos.getPhoto(BOB)]);

  assert.deepEqual(alice, { ok: false, error: 'socket timed out' });
  assert.equal(bob.ok, true);
  assert.ok(bob.photo);
  // Nothing cached for the failure, so it isn't mistaken for a confirmed "no photo".
  assert.deepEqual(getPhotoCache(ALICE), { url: null, fetchedAt: null });
  assert.equal(photos.photoPath(ALICE), `/api/contacts/${encodeURIComponent(ALICE)}/photo`);
});

test('a failed lookup backs off instead of re-querying WhatsApp on every request, then retries', async () => {
  seedContacts(ALICE);
  let fail = true;
  const { photos, sock, clock } = setup({
    lookup: (jid) => {
      if (fail) throw new Error('rate-overlimit');
      return cdnUrl(jid);
    },
  });

  assert.equal((await photos.getPhoto(ALICE)).ok, false);
  assert.equal((await photos.getPhoto(ALICE)).ok, false);
  assert.equal(sock.calls.length, 1);

  fail = false;
  clock.now += 16 * 60 * 1000;
  assert.equal((await photos.getPhoto(ALICE)).ok, true);
  assert.equal(sock.calls.length, 2);
});

test('a disconnected socket fails open without calling Baileys', async () => {
  seedContacts(ALICE);
  const { photos, sock } = setup({ connected: false });

  assert.deepEqual(await photos.getPhoto(ALICE), { ok: false, error: 'WhatsApp socket is not connected' });
  assert.equal(sock.calls.length, 0);
});

test('a JID that is not in the directory is never looked up', async () => {
  const { photos, sock } = setup();

  assert.deepEqual(await photos.getPhoto(ALICE), { ok: true, photo: null });
  assert.equal(sock.calls.length, 0);
  assert.equal(photos.photoPath(ALICE), null);
});

test('a second request within the freshness window is a cache hit (no second Baileys call)', async () => {
  seedContacts(ALICE);
  const { photos, sock, clock } = setup();

  await photos.getPhoto(ALICE);
  clock.now += PHOTO_REFRESH_MS - 1;
  const again = await photos.getPhoto(ALICE);

  assert.equal(again.ok, true);
  assert.ok(again.photo);
  assert.equal(sock.calls.length, 1);
});

test('a request past the freshness window re-calls Baileys and picks up a changed photo', async () => {
  seedContacts(ALICE);
  let version = 1;
  const { photos, sock, fetchImpl, clock } = setup({ lookup: (jid) => cdnUrl(jid, version) });

  await photos.getPhoto(ALICE);
  version = 2;
  clock.now += PHOTO_REFRESH_MS;
  await photos.getPhoto(ALICE);

  assert.equal(sock.calls.length, 2);
  assert.deepEqual(fetchImpl.calls, [cdnUrl(ALICE, 1), cdnUrl(ALICE, 2)]);
  assert.equal(photos.photoPath(ALICE), `/api/contacts/${encodeURIComponent(ALICE)}/photo?v=${clock.now}`);
});

test('a confirmed "no photo" is re-checked once stale, so a newly-set photo eventually shows up', async () => {
  seedContacts(ALICE);
  let hasPhoto = false;
  const { photos, clock } = setup({ lookup: (jid) => (hasPhoto ? cdnUrl(jid) : undefined) });

  await photos.getPhoto(ALICE);
  assert.equal(photos.photoPath(ALICE), null);

  hasPhoto = true;
  clock.now += PHOTO_REFRESH_MS;
  assert.notEqual(photos.photoPath(ALICE), null);
  assert.ok((await photos.getPhoto(ALICE)).photo);
});

test('never has more than PHOTO_LOOKUP_CONCURRENCY Baileys lookups in flight at once', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `1555000${String(i).padStart(4, '0')}@s.whatsapp.net`);
  seedContacts(...ids);
  let active = 0;
  let maxActive = 0;
  const { photos, sock } = setup({
    lookup: async (jid) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return cdnUrl(jid);
    },
  });

  const results = await Promise.all(ids.map((id) => photos.getPhoto(id)));

  assert.equal(maxActive, PHOTO_LOOKUP_CONCURRENCY);
  assert.equal(sock.calls.length, ids.length);
  assert.ok(results.every((r) => r.ok && r.photo));
});

test('concurrent requests for the same contact share a single lookup', async () => {
  seedContacts(ALICE);
  const { photos, sock } = setup({
    lookup: async (jid) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return cdnUrl(jid);
    },
  });

  const results = await Promise.all([photos.getPhoto(ALICE), photos.getPhoto(ALICE), photos.getPhoto(ALICE)]);

  assert.equal(sock.calls.length, 1);
  assert.ok(results.every((r) => r.ok && r.photo));
});

test('an expired CDN URL triggers exactly one forced re-lookup', async () => {
  seedContacts(ALICE);
  let version = 1;
  const { photos, sock, fetchImpl } = setup({
    lookup: (jid) => cdnUrl(jid, version++),
    respond: (url) => (url === cdnUrl(ALICE, 1) ? new Response(null, { status: 403 }) : imageResponse()),
  });

  const result = await photos.getPhoto(ALICE);

  assert.equal(result.ok, true);
  assert.ok(result.photo);
  assert.equal(sock.calls.length, 2);
  assert.deepEqual(fetchImpl.calls, [cdnUrl(ALICE, 1), cdnUrl(ALICE, 2)]);
});

test('a CDN that keeps rejecting fresh URLs fails open after one retry instead of looping', async () => {
  seedContacts(ALICE);
  const { photos, sock } = setup({ respond: () => new Response(null, { status: 403 }) });

  const result = await photos.getPhoto(ALICE);

  assert.equal(result.ok, false);
  assert.equal(sock.calls.length, 2);
});

test('a failed download (network error) fails open', async () => {
  seedContacts(ALICE);
  const { photos } = setup({
    respond: () => {
      throw new TypeError('fetch failed');
    },
  });

  assert.deepEqual(await photos.getPhoto(ALICE), { ok: false, error: 'fetch failed' });
});

test('a non-WhatsApp-CDN URL is never fetched server-side', async () => {
  seedContacts(ALICE);
  const { photos, fetchImpl } = setup({ lookup: () => 'http://127.0.0.1:11434/api/tags' });

  const result = await photos.getPhoto(ALICE);

  assert.equal(result.ok, false);
  assert.equal(fetchImpl.calls.length, 0);
});

test('a non-image (or SVG) CDN response is refused rather than re-served from this origin', async () => {
  seedContacts(ALICE, BOB);
  const { photos } = setup({
    respond: (url) => (url === cdnUrl(ALICE) ? imageResponse('<html></html>', 'text/html') : imageResponse('<svg/>', 'image/svg+xml')),
  });

  assert.equal((await photos.getPhoto(ALICE)).ok, false);
  assert.equal((await photos.getPhoto(BOB)).ok, false);
});

test('an oversized CDN response is refused', async () => {
  seedContacts(ALICE);
  const { photos } = setup({ respond: () => imageResponse(Buffer.alloc(2 * 1024 * 1024)) });

  const result = await photos.getPhoto(ALICE);

  assert.equal(result.ok, false);
  assert.match(result.error, /exceeded/);
});
