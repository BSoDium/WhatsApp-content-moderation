import { useState } from 'react';
import { ArrowLeft, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ContactAvatar } from './ContactAvatar';
import { SettingRow } from './SettingRow';
import { relativeTime } from '@/lib/contact';
import { formatTimestamp } from '@/lib/activity';
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
  const selfLocked = contact.isSelf && !contact.allowSelf;

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
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Back to contact list" className="-ml-2">
          <ArrowLeft />
        </Button>
        <ContactAvatar contact={contact} size="lg" />
        <div className="min-w-0">
          <p className="text-lg font-semibold">{contact.name}</p>
          <p className="text-sm text-muted-foreground">{relativeTime(contact.lastMessageAt)}</p>
        </div>
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-muted/40 px-4">
          <SettingRow
            title="Moderate this contact"
            description={
              selfLocked
                ? "This is your own account — it can't be moderated. Set TEST_ALLOW_SELF=1 to test the pipeline against messages you send yourself."
                : monitored
                  ? undefined
                  : 'Start tracking strikes and enable auto-blocking for this contact.'
            }
            control={
              <Switch
                checked={monitored}
                disabled={pending.has('monitor') || selfLocked}
                onCheckedChange={(checked) => withPending('monitor', () => onToggleMonitor(contact.id, checked))}
              />
            }
          />
        </section>

        <section className="rounded-xl border border-border bg-card px-4">
          <SettingRow title="Strikes" control={<span className="tabular-nums">{entry?.strikeCount ?? 0}</span>} />
          <Separator />
          <SettingRow
            title="Block"
            description={entry?.block ? `Until ${formatTimestamp(entry.block.unblockAt)}` : undefined}
            control={
              entry?.block ? (
                <Button variant="outline" size="sm" disabled={pending.has('unblock')} onClick={() => withPending('unblock', () => runAndReport('unblock'))}>
                  Unblock
                </Button>
              ) : (
                <span className="text-muted-foreground">Not blocked</span>
              )
            }
          />
          <Separator />
          <SettingRow
            title="Message history"
            description="Includes anything already deleted."
            control={
              <Button variant="outline" size="sm" onClick={() => onViewHistory(contact.id)}>
                <History data-icon="inline-start" />
                View
              </Button>
            }
          />
        </section>

        <section className="rounded-xl border border-border bg-card px-4">
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
        </section>
      </div>

      <p className="mt-4 min-h-[1.5em] text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
