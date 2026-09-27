import { useState } from 'react';
import { ArrowLeft, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ContactAvatar } from './ContactAvatar';
import { SettingRow } from './SettingRow';
import { relativeTime } from '@/lib/contact';
import type { Contact, OverrideCommand, RosterEntry } from '@/lib/types';

interface ContactDetailPanelProps {
  contact: Contact | null;
  entry: RosterEntry | undefined;
  onClose: () => void;
  onToggleMonitor: (contactId: string, monitored: boolean) => Promise<void>;
  onRunCommand: (contactId: string, action: OverrideCommand) => Promise<string | undefined>;
  onSetEscalation: (contactId: string, enabled: boolean) => Promise<void>;
  onViewHistory: (contactId: string) => void;
}

// The caller mounts this with `key={contact.id}` so `message` resets by
// remounting on a new selection, rather than needing an effect to reset it.
export function ContactDetailPanel({ contact, entry, onClose, onToggleMonitor, onRunCommand, onSetEscalation, onViewHistory }: ContactDetailPanelProps) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(() => new Set());

  if (!contact) return null;

  const contactId = contact.id;
  const monitored = Boolean(entry);

  // Guards against a rapid double-click firing two overlapping requests for the same control (each key here is independent, so other controls stay usable).
  async function withPending(key: string, fn: () => Promise<unknown>): Promise<void> {
    setPending((prev) => new Set(prev).add(key));
    try {
      await fn();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function runAndReport(action: OverrideCommand): Promise<void> {
    const result = await onRunCommand(contactId, action);
    if (result !== undefined) setMessage(result);
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-y-auto px-4 pt-4 pb-16 lg:min-w-[500px] lg:px-8 lg:pt-20">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Back to contact list">
          <ArrowLeft />
        </Button>
        <ContactAvatar contact={contact} size="lg" />
        <div className="min-w-0">
          <p className="font-medium">{contact.name}</p>
          <p className="text-sm text-muted-foreground">{relativeTime(contact.lastMessageAt)}</p>
        </div>
      </div>

      <div>
        <SettingRow
          title="Moderate this contact"
          description={monitored ? undefined : 'Start tracking strikes and enable auto-blocking for this contact.'}
          control={
            <Switch
              checked={monitored}
              disabled={pending.has('monitor')}
              onCheckedChange={(checked) => withPending('monitor', () => onToggleMonitor(contact.id, checked))}
            />
          }
        />
        <Separator />
        <SettingRow title="Strikes" control={<span>{entry?.strikeCount ?? 0}</span>} />
        <Separator />
        <SettingRow
          title="Block"
          control={<span>{entry?.block ? `until ${new Date(entry.block.unblockAt).toLocaleString()}` : 'Not blocked'}</span>}
        />
        <Separator />
        <SettingRow
          title="Message history"
          description="Every message logged for this contact, including anything deleted."
          control={
            <Button variant="outline" size="sm" onClick={() => onViewHistory(contact.id)}>
              <History data-icon="inline-start" />
              View
            </Button>
          }
        />
        <Separator />
        <SettingRow
          title="Paused"
          description="Temporarily stop moderating without losing strike history."
          control={
            <Switch
              checked={Boolean(entry?.paused)}
              disabled={!monitored || pending.has('pause')}
              onCheckedChange={(checked) => withPending('pause', () => runAndReport(checked ? 'pause' : 'resume'))}
            />
          }
        />
        <Separator />
        <SettingRow
          title="Escalation"
          description="Automatically block this contact after too many strikes."
          control={
            <Switch
              checked={entry?.escalationEnabled ?? true}
              disabled={!monitored || pending.has('escalation')}
              onCheckedChange={(checked) => withPending('escalation', () => onSetEscalation(contact.id, checked))}
            />
          }
        />
        <Separator />
      </div>

      <div className="mt-6">
        <Button
          variant="destructive"
          disabled={!monitored || pending.has('unblock')}
          onClick={() => withPending('unblock', () => runAndReport('unblock'))}
        >
          Unblock now
        </Button>
        <p className="mt-3 min-h-[1.5em] text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
