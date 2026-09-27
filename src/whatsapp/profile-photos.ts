import pino from 'pino';
import { createConcurrencyLimiter } from './concurrency-limiter.ts';
import { downloadPhoto } from './photo-download.ts';
import { getPhotoCache, invalidatePhotoCache, setPhotoCache } from '../store/contact-photos.ts';
import type { WASocket } from '@whiskeysockets/baileys';
import type { PhotoCacheEntry } from '../store/contact-photos.ts';

// Every lookup is an IQ query over the linked-device socket, and a burst of
// them across a whole contact list is exactly the kind of unusual traffic
// that risks the account (see docs/decisions.md's "The block/unblock cycle
// is itself a ban signal") — so it's capped low, and exported for tests.
export const PHOTO_LOOKUP_CONCURRENCY = 3;
// Downloads hit WhatsApp's CDN rather than the socket, so they're less
// sensitive, but still shouldn't fan out to one request per contact at once.
const PHOTO_DOWNLOAD_CONCURRENCY = 4;
// Photos rarely change, and a real change also arrives as a contacts.update
// {imgUrl: 'changed'} that invalidates the cache early (contact-directory.ts),
// so this mostly bounds how stale a signed CDN URL can get.
export const PHOTO_REFRESH_MS = 24 * 60 * 60 * 1000;
// Keeps a contact whose lookup keeps failing (or a disconnected socket) from
// re-querying WhatsApp on every page load.
const FAILURE_BACKOFF_MS = 900_000;
// Well under Baileys' 60s default query timeout, so a stalled lookup can't
// hold one of the few limiter slots for a full minute.
const LOOKUP_TIMEOUT_MS = 15_000;
// WhatsApp's ~96px thumbnail — enough for the largest avatar at 2x DPR, a
// fraction of the full-size image's bytes.
const PHOTO_TYPE = 'preview';
// Baileys reports "no photo, or hidden from us by privacy settings" as an IQ
// error node thrown as a Boom with the code in `.data` (404 item-not-found,
// 401 not-authorized), not as an undefined return.
const IQ_NOT_AUTHORIZED = 401;
const IQ_FORBIDDEN = 403;
const IQ_ITEM_NOT_FOUND = 404;
const NO_PHOTO_ERROR_CODES = new Set([IQ_NOT_AUTHORIZED, IQ_FORBIDDEN, IQ_ITEM_NOT_FOUND]);

const logger = pino({ name: 'profile-photos' });

export type PhotoLookup = { ok: true; url: string | null } | { ok: false; error: string };
export type PhotoFetch = { ok: true; photo: { body: Buffer; contentType: string } | null } | { ok: false; error: string };

interface ProfilePhotoDependencies {
  getSocket: () => Pick<WASocket, 'profilePictureUrl'> | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function isNoPhotoError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'data' in err && NO_PHOTO_ERROR_CODES.has(err.data as number);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Creates the profile-photo cache: lazily resolves a contact's WhatsApp
 * profile photo through Baileys' `profilePictureUrl`, caches the result
 * (including "no photo") on the contact's directory row for
 * PHOTO_REFRESH_MS, and proxies the image bytes for the control server.
 *
 * Lookups are only ever triggered by a request for that contact's photo —
 * never eagerly on connect — and are capped at PHOTO_LOOKUP_CONCURRENCY
 * in flight across the whole process, with concurrent requests for the
 * same contact sharing one lookup. Only contacts already in the directory
 * are looked up.
 *
 * Fails open: nothing here throws on a WhatsApp/CDN failure. A failed
 * lookup or download comes back as `{ ok: false }` (logged, then retried
 * no sooner than FAILURE_BACKOFF_MS later), which the caller treats the
 * same as "no photo" — the frontend falls back to initials.
 */
export function createProfilePhotos({ getSocket, fetchImpl = fetch, now = Date.now }: ProfilePhotoDependencies) {
  const lookupLimiter = createConcurrencyLimiter(PHOTO_LOOKUP_CONCURRENCY);
  const downloadLimiter = createConcurrencyLimiter(PHOTO_DOWNLOAD_CONCURRENCY);
  const inFlight = new Map<string, Promise<PhotoLookup>>();
  const lastFailureAt = new Map<string, number>();

  function isFresh(cache: PhotoCacheEntry): boolean {
    return cache.fetchedAt !== null && now() - cache.fetchedAt < PHOTO_REFRESH_MS;
  }

  async function queryWhatsApp(contactId: string): Promise<PhotoLookup> {
    const sock = getSocket();
    if (!sock) return { ok: false, error: 'WhatsApp socket is not connected' };
    try {
      const url = await sock.profilePictureUrl(contactId, PHOTO_TYPE, LOOKUP_TIMEOUT_MS);
      return { ok: true, url: url || null };
    } catch (err) {
      if (isNoPhotoError(err)) return { ok: true, url: null };
      return { ok: false, error: errorMessage(err) };
    }
  }

  async function refresh(contactId: string): Promise<PhotoLookup> {
    const result = await lookupLimiter.run(() => queryWhatsApp(contactId));
    if (result.ok) {
      setPhotoCache(contactId, result.url, now());
      lastFailureAt.delete(contactId);
    } else {
      lastFailureAt.set(contactId, now());
      logger.warn({ contactId, error: result.error }, 'profile photo lookup failed; falling back to initials');
    }
    return result;
  }

  async function lookupPhotoUrl(contactId: string): Promise<PhotoLookup> {
    const cache = getPhotoCache(contactId);
    if (!cache) return { ok: true, url: null };
    if (isFresh(cache)) return { ok: true, url: cache.url };

    const failedAt = lastFailureAt.get(contactId);
    if (failedAt !== undefined && now() - failedAt < FAILURE_BACKOFF_MS) {
      return { ok: false, error: 'a recent lookup failed; backing off' };
    }

    const pending = inFlight.get(contactId);
    if (pending) return pending;
    const lookup = refresh(contactId).finally(() => inFlight.delete(contactId));
    inFlight.set(contactId, lookup);
    return lookup;
  }

  async function download(contactId: string, url: string) {
    const result = await downloadLimiter.run(() => downloadPhoto(url, fetchImpl));
    if (!result.ok) logger.warn({ contactId, error: result.error, expired: result.expired }, 'profile photo download failed');
    return result;
  }

  async function getPhoto(contactId: string): Promise<PhotoFetch> {
    const lookup = await lookupPhotoUrl(contactId);
    if (!lookup.ok) return lookup;
    if (!lookup.url) return { ok: true, photo: null };

    let result = await download(contactId, lookup.url);
    // Signed CDN URLs can expire before PHOTO_REFRESH_MS does; one forced
    // re-lookup recovers without waiting out the refresh window. Only once,
    // so a CDN that keeps rejecting fresh URLs can't loop.
    if (!result.ok && result.expired) {
      invalidatePhotoCache(contactId);
      const retry = await lookupPhotoUrl(contactId);
      if (!retry.ok) return retry;
      if (!retry.url) return { ok: true, photo: null };
      result = await download(contactId, retry.url);
    }

    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, photo: { body: result.body, contentType: result.contentType } };
  }

  // Null only when a fresh lookup already confirmed there's no photo, so the
  // frontend skips requesting it. `v` changes on every refresh, busting the
  // browser's cached copy whenever the server may have a newer photo.
  function photoPath(contactId: string): string | null {
    const cache = getPhotoCache(contactId);
    if (!cache || (isFresh(cache) && !cache.url)) return null;
    const path = `/api/contacts/${encodeURIComponent(contactId)}/photo`;
    return cache.fetchedAt ? `${path}?v=${cache.fetchedAt}` : path;
  }

  return { getPhoto, photoPath };
}
