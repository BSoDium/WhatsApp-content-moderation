import { useEffect, type ReactNode } from 'react';
import type { Decorator } from '@storybook/react-vite';

export interface MockRoute {
  method?: string;
  match: string | RegExp;
  status?: number;
  body?: unknown;
  // Kept separate from `body` (rather than a `unknown | Fn` union) because a union with `unknown` collapses to `unknown`, breaking inline handlers' param inference.
  bodyFn?: (path: string, init?: RequestInit) => unknown;
  delayMs?: number;
}

function matches(route: MockRoute, method: string, path: string): boolean {
  if ((route.method ?? 'GET').toUpperCase() !== method.toUpperCase()) return false;
  return typeof route.match === 'string' ? route.match === path : route.match.test(path);
}

function buildMockFetch(routes: MockRoute[], passthrough: typeof fetch): typeof fetch {
  return async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
    const path = new URL(rawUrl, window.location.origin).pathname;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const route = routes.find((candidate) => matches(candidate, method, path));
    if (!route) return passthrough(input, init);
    if (route.delayMs) await new Promise((resolve) => setTimeout(resolve, route.delayMs));
    const body = route.bodyFn ? route.bodyFn(path, init) : route.body;
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

// Storybook has no server for GET /api/events; this no-op replaces a real EventSource that would otherwise retry a dead connection forever.
class NoopEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close(): void {}
}

// Captured once (real fetch/EventSource, never a previous story's mock) so both passthrough and restoreRealApi always land on the genuine originals.
let realFetch: typeof fetch | undefined;
let realEventSource: typeof EventSource | undefined;

function installMockApi(routes: MockRoute[]): void {
  realFetch ??= window.fetch;
  realEventSource ??= window.EventSource;
  window.fetch = buildMockFetch(routes, realFetch);
  window.EventSource = NoopEventSource as unknown as typeof EventSource;
}

function restoreRealApi(): void {
  if (realFetch) window.fetch = realFetch;
  if (realEventSource) window.EventSource = realEventSource;
}

// Effect-only cleanup: restoring on unmount (this story going away) has no ordering constraint, unlike installing the mock, which must happen before this story's own children mount.
function MockApiCleanup({ children }: { children: ReactNode }) {
  useEffect(() => restoreRealApi, []);
  return <>{children}</>;
}

// Stubs fetch/EventSource before a story renders (in the decorator itself, not a component render/effect) so a child's fetch-on-mount effect always sees the mock, and restores the real ones once the story unmounts.
export function withMockApi(routes: MockRoute[]): Decorator {
  return (Story) => {
    installMockApi(routes);
    return (
      <MockApiCleanup>
        <Story />
      </MockApiCleanup>
    );
  };
}
