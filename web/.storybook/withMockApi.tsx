import type { Decorator } from '@storybook/react-vite';

export interface MockRoute {
  method?: string;
  match: string | RegExp;
  status?: number;
  body?: unknown;
  // Separate from `body` rather than a `unknown | Fn` union: TypeScript
  // collapses any union containing `unknown` back down to `unknown`, which
  // would leave every inline route handler's (path, init) params as
  // implicit `any`.
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

// The app also opens an EventSource for live push updates (GET /api/events).
// Storybook has no server to answer it, so this swaps in a no-op instead of
// leaving the browser retrying a real connection in the background forever.
class NoopEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close(): void {}
}

// window.fetch itself (not a ref/component state), captured the first time
// any story installs a mock — every later install rebuilds the mock from
// this same real fetch, so passthrough (an unmatched route) always reaches
// the network rather than a previous story's mock.
let realFetch: typeof fetch | undefined;

function installMockApi(routes: MockRoute[]): void {
  realFetch ??= window.fetch;
  window.fetch = buildMockFetch(routes, realFetch);
  window.EventSource = NoopEventSource as unknown as typeof EventSource;
}

// Stubs window.fetch (and EventSource) before a story renders, so components
// whose data comes from hooks calling the real /api/* endpoints (App,
// OverviewStats, SettingsPanel, PolicyEditor, ActivityPanel) render against
// fixture data instead of every request failing against Storybook's static
// file server. Installed directly in the decorator (not from inside a
// component's render or effect) so it's in place before any child component
// underneath fires its own fetch-on-mount effect. A route's `bodyFn` can
// close over local state if a story needs a mutation (e.g. POST
// /api/roster) reflected by a later GET in the same story.
export function withMockApi(routes: MockRoute[]): Decorator {
  return (Story) => {
    installMockApi(routes);
    return <Story />;
  };
}
