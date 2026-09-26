const TOKEN_KEY = 'controlToken';

type ApiOptions = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

// Populated by index.html's inline bootstrap script — safe to serve this bundle unauthenticated since its source never contains the token itself.
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { 'X-Control-Token': token, ...extra } : extra;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const res = await fetch(path, { ...options, headers: authHeaders(options.headers) });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Request failed (${res.status})`;
    throw new Error(error);
  }
  return body as T;
}
