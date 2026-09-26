type ApiOptions = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const res = await fetch(path, options);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Request failed (${res.status})`;
    throw new Error(error);
  }
  return body as T;
}
