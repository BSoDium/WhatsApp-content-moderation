const TOKEN_KEY = 'controlToken';

// Populated by index.html's inline bootstrap script — safe to serve this bundle unauthenticated since its source never contains the token itself.
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { 'X-Control-Token': token, ...extra } : extra;
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(path, { ...options, headers: authHeaders(options.headers) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}
