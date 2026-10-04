import type { OverrideCommand } from '@/lib/types';
import type { CommandResult, DemoBackend } from './backend';
import { DEMO_USER } from './tailnet';

export interface DemoResponse {
  status: number;
  body: unknown;
}

const OVERRIDE_COMMANDS: ReadonlySet<string> = new Set<OverrideCommand>(['pause', 'resume', 'unblock', 'reset-strikes']);

function fromResult(result: CommandResult, status = 200): DemoResponse {
  return result.ok ? { status, body: result.body } : { status: result.status, body: { error: result.error } };
}

function badRequest(error: string): DemoResponse {
  return { status: 400, body: { error } };
}

function parseBody(raw: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function handleRoster(backend: DemoBackend, method: string, segments: string[], body: Record<string, unknown>): DemoResponse | null {
  if (method === 'GET' && segments.length === 1) return { status: 200, body: backend.listRoster(Date.now()) };
  if (method === 'POST' && segments.length === 1) {
    if (typeof body.contactId !== 'string' || body.contactId === '') return badRequest('contactId must be a non-empty string');
    return fromResult(backend.addToRoster(body.contactId), 201);
  }
  if (method === 'DELETE' && segments.length === 2) return fromResult(backend.removeFromRoster(segments[1]));
  if (method !== 'POST' || segments.length !== 3) return null;

  const [, contactId, action] = segments;
  if (OVERRIDE_COMMANDS.has(action)) return fromResult(backend.runOverride(contactId, action as OverrideCommand));
  if (action === 'escalation') {
    return typeof body.enabled === 'boolean' ? fromResult(backend.setEscalation(contactId, body.enabled)) : badRequest('enabled must be a boolean');
  }
  if (action === 'context') {
    return typeof body.context === 'string' ? fromResult(backend.setContext(contactId, body.context)) : badRequest('context must be a string');
  }
  if (action === 'call-nuisance-threshold') {
    const { threshold } = body;
    const valid = threshold === null || (typeof threshold === 'number' && Number.isInteger(threshold) && threshold >= 0);
    return valid ? fromResult(backend.setCallThreshold(contactId, threshold as number | null)) : badRequest('threshold must be a non-negative integer, or null to use the global default');
  }
  if (action === 'block-backoff-max') {
    const { maxDurationMs } = body;
    const valid = maxDurationMs === null || (typeof maxDurationMs === 'number' && Number.isSafeInteger(maxDurationMs) && maxDurationMs >= 1);
    return valid ? fromResult(backend.setBlockBackoffMax(contactId, maxDurationMs as number | null)) : badRequest('maxDurationMs must be a positive integer, or null to use the global cap');
  }
  return null;
}

export function handleDemoRequest(backend: DemoBackend, method: string, url: URL, rawBody: BodyInit | null | undefined): DemoResponse {
  const segments = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
  const body = parseBody(rawBody);
  const now = Date.now();

  if (method === 'GET' && segments.length === 1) {
    switch (segments[0]) {
      case 'contacts':
        return { status: 200, body: backend.listContacts(now) };
      case 'stats':
        return { status: 200, body: backend.stats(now) };
      case 'audit-log':
        return { status: 200, body: backend.auditPage(url.searchParams) };
      case 'meta':
        return { status: 200, body: { authRequired: true, user: DEMO_USER } };
      case 'status':
        return { status: 200, body: backend.status(now) };
      case 'policy':
        return { status: 200, body: { text: backend.getPolicy() } };
      case 'settings':
        return { status: 200, body: backend.listSettings() };
    }
  }

  if (method === 'GET' && segments.length === 2 && segments[0] === 'ollama' && segments[1] === 'models') {
    return {
      status: 200,
      body: {
        models: [
          { name: 'llama3.2:3b', sizeBytes: 2019393189 },
          { name: 'qwen2.5:7b', sizeBytes: 4683087332 },
        ],
      },
    };
  }

  if (method === 'POST' && segments.length === 1 && segments[0] === 'policy') {
    return typeof body.text === 'string' ? fromResult(backend.setPolicy(body.text)) : badRequest('text must be a string');
  }
  if (method === 'POST' && segments.length === 2 && segments[0] === 'settings') {
    return typeof body.value === 'string' ? fromResult(backend.setSetting(segments[1], body.value)) : badRequest('value must be a string');
  }
  if (segments[0] === 'roster') {
    const response = handleRoster(backend, method, segments, body);
    if (response) return response;
  }
  return { status: 404, body: { error: 'not found' } };
}
