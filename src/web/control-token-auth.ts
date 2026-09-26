import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

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
function tokensMatch(provided: string | string[] | undefined | null, expectedToken: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expectedToken);
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}

export function verifyControlToken(req: IncomingMessage, searchParams: URLSearchParams, expectedToken: string): boolean {
  const provided = req.headers['x-control-token'] ?? searchParams.get('token');
  return tokensMatch(provided, expectedToken);
}

export const CONTROL_TOKEN_COOKIE = 'controlToken';

/**
 * Verifies the token via the `controlToken` cookie — the only way `GET /`
 * itself (a plain browser navigation, not a fetch() app.js makes) can carry
 * a credential on a reload once the bootstrap link's `?token=` has already
 * been stripped from the URL: browsers attach cookies automatically to a
 * top-level navigation, but never a custom header, so this is the one auth
 * path that doesn't depend on any client-side JS having already run.
 *
 * Deliberately **not** accepted for `/api/*` — only `GET /` calls this.
 * `verifyControlToken`'s header/query check remains the sole credential for
 * every state-changing route specifically because a cookie is what a
 * cross-origin page can also have the browser attach on its behalf (the
 * classic CSRF vector); the custom header can't be forged that way. Mixing
 * the two into one acceptance path for API routes would quietly reopen the
 * CSRF gap `docs/decisions.md` documents the header as closing.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {string} expectedToken
 * @returns {boolean}
 */
export function verifyControlCookie(req: IncomingMessage, expectedToken: string): boolean {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return false;

  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CONTROL_TOKEN_COOKIE}=`));
  if (!match) return false;

  const provided = decodeURIComponent(match.slice(CONTROL_TOKEN_COOKIE.length + 1));
  return tokensMatch(provided, expectedToken);
}
