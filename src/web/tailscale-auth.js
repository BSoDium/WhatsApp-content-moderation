/**
 * Verifies a request's Tailscale identity against the single allow-listed
 * login, using the `Tailscale-User-Login` header that `tailscale serve`
 * sets when proxying a tailnet request to this app — see
 * docs/decisions.md "Web control app: Tailscale identity headers (issue
 * #29)" for the full design and, critically, why this header can only be
 * trusted when the app is unreachable except through that proxy (see
 * src/web/control-server.js).
 *
 * Exact string match, no normalization — set ALLOWED_TAILSCALE_LOGIN to
 * exactly what Tailscale reports for your own login.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {string} allowedLogin
 * @returns {boolean}
 */
export function verifyTailscaleIdentity(req, allowedLogin) {
  const login = req.headers['tailscale-user-login'];
  return typeof login === 'string' && login.length > 0 && login === allowedLogin;
}
