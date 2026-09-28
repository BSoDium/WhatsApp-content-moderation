const DOWNLOAD_TIMEOUT_MS = 10_000;
// A 'preview' thumbnail is a few KB; this is a ceiling against a
// misbehaving upstream, not a size budget.
const MAX_PHOTO_BYTES = 1_048_576;
// Only what WhatsApp actually serves profile photos as — notably never
// image/svg+xml, which could carry script once re-served from this app's
// own origin.
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Profile photos live on pps.whatsapp.net; the URL comes from WhatsApp via
// the DB, but this server fetches it with its own network access, so it's
// pinned to WhatsApp's CDN rather than trusted as an arbitrary URL.
const ALLOWED_HOST_SUFFIX = '.whatsapp.net';
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_GONE = 410;
// How WhatsApp's CDN answers a signed URL past its `oe=` expiry.
const EXPIRED_STATUSES = new Set([HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_GONE]);

export type PhotoDownload =
  | { ok: true; body: Buffer; contentType: string }
  | { ok: false; expired: boolean; error: string };

function isAllowedPhotoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname.endsWith(ALLOWED_HOST_SUFFIX);
  } catch {
    return false;
  }
}

async function readCapped(body: ReadableStream<Uint8Array>): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > MAX_PHOTO_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetches a cached profile-photo URL's image bytes server-side, so the
 * frontend only ever sees this app's own proxy route, never the signed CDN
 * URL. Never throws: any failure comes back as `{ ok: false }`, with
 * `expired` set when the CDN rejected the URL itself (a stale signature),
 * which a caller can recover from by re-looking the URL up.
 */
export async function downloadPhoto(url: string, fetchImpl: typeof fetch = fetch): Promise<PhotoDownload> {
  if (!isAllowedPhotoUrl(url)) return { ok: false, expired: false, error: 'photo URL is not an https WhatsApp CDN URL' };

  try {
    const res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, expired: EXPIRED_STATUSES.has(res.status), error: `CDN responded with HTTP ${res.status}` };
    }

    const contentType = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!ALLOWED_CONTENT_TYPES.has(contentType) || !res.body) {
      await res.body?.cancel();
      return { ok: false, expired: false, error: `unexpected photo content type: ${contentType || '(none)'}` };
    }

    const body = await readCapped(res.body);
    if (!body) return { ok: false, expired: false, error: `photo exceeded ${MAX_PHOTO_BYTES} bytes` };
    return { ok: true, body, contentType };
  } catch (err) {
    return { ok: false, expired: false, error: err instanceof Error ? err.message : String(err) };
  }
}
