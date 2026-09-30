import type { ControlTopic, DemoBackend } from './backend';
import { handleDemoRequest } from './routes';

const RESPONSE_DELAY_MS = 60;
const API_PREFIX = '/api/';

function makeDemoEventSource(backend: DemoBackend): typeof EventSource {
  return class DemoEventSource {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent<ControlTopic>) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    private readonly unsubscribe: () => void;
    private closed = false;

    constructor() {
      this.unsubscribe = backend.subscribe((topic) => {
        if (!this.closed) this.onmessage?.(new MessageEvent('message', { data: topic }));
      });
      queueMicrotask(() => {
        if (!this.closed) this.onopen?.(new Event('open'));
      });
    }

    close(): void {
      this.closed = true;
      this.unsubscribe();
    }
  } as unknown as typeof EventSource;
}

export function installDemoApi(backend: DemoBackend): void {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
    const url = new URL(rawUrl, window.location.origin);
    if (!url.pathname.startsWith(API_PREFIX)) return realFetch(input, init);

    await new Promise((resolve) => setTimeout(resolve, RESPONSE_DELAY_MS));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const { status, body } = handleDemoRequest(backend, method.toUpperCase(), url, init?.body);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };

  window.EventSource = makeDemoEventSource(backend);
}
