export interface Contact {
  id: string;
  name: string;
  lastMessageAt: number | null;
}

export interface RosterEntry {
  id: string;
  name: string;
  escalationEnabled: boolean;
  paused: boolean;
  strikeCount: number;
  block: { unblockAt: number } | null;
}

export interface ControlError {
  title: string;
  description: string;
  retry?: () => void | Promise<void>;
}

export type OverrideCommand = 'pause' | 'resume' | 'unblock';
