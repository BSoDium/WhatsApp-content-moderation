export type WhatsAppStatus = 'connecting' | 'open' | 'reconnecting' | 'offline' | 'logged-out';

export interface ConnectionState {
  status: WhatsAppStatus;
  since: number;
  statusCode: number | null;
}

let current: ConnectionState = { status: 'connecting', since: Date.now(), statusCode: null };

export function setConnectionState(status: WhatsAppStatus, statusCode: number | null = null): void {
  current = { status, since: Date.now(), statusCode };
}

export function getConnectionState(): ConnectionState {
  return current;
}
