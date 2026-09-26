import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ContactAvatar } from './ContactAvatar';
import { SettingRow } from './SettingRow';
import { relativeTime } from '@/lib/contact';

// The caller mounts this with `key={contact.id}` so `message` resets by
// remounting on a new selection, rather than needing an effect to reset it.
export function ContactDetailPanel({ contact, entry, onClose, onToggleMonitor, onRunCommand, onSetEscalation }) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(() => new Set());

  if (!contact) return null;

  const monitored = Boolean(entry);

  // Guards against a rapid double-click firing two overlapping requests for the same control (each key here is independent, so other controls stay usable).
  async function withPending(key, fn) {
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

  async function runAndReport(action) {
    const result = await onRunCommand(contact.id, action);
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
