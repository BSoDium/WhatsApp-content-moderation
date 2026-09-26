import { timingSafeEqual } from 'node:crypto';

/**
 * Verifies the second auth factor: a shared secret only this app's
 * operator knows, required in addition to the Tailscale identity header —
 * see docs/decisions.md "Web control app: Tailscale identity headers
 * (issue #29)". The Tailscale header alone can be set by any local
 * process/user on the same host (nothing about the request distinguishes
 * one proxied in by `tailscale serve` from one connected directly to
 * loopback), so this closes that gap: the token isn't derivable from the
 * header or the request itself, only from `CONTROL_SERVER_TOKEN`.
 *
 * Accepts the token from either the `X-Control-Token` header (sent by every
 * fetch() the served page makes) or a `token` query parameter (used for the
 * first page load, before the page's own script has a copy to attach as a
 * header).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {URLSearchParams} searchParams
 * @param {string} expectedToken
 * @returns {boolean}
 */
export function verifyControlToken(req, searchParams, expectedToken) {
  const provided = req.headers['x-control-token'] ?? searchParams.get('token');
  if (typeof provided !== 'string' || provided.length === 0) return false;

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expectedToken);
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}
