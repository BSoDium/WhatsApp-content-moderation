import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
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
  onSetContext: (contactId: string, context: string) => Promise<true>;
  onViewHistory: (contactId: string) => void;
}

// Lets the parent (App.tsx) ask "is it safe to switch away from this
// contact / close this panel right now" before it discards this component
// by remounting it with a different `key` — the moderation-context draft
// below is the one field here with unsaved state that a silent remount
// would otherwise lose.
export interface ContactDetailPanelHandle {
  hasUnsavedChanges: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

type ContextSaveState = 'idle' | 'saving' | 'saved' | 'error';

// How long the "Saved" confirmation stays up before fading back to idle —
// long enough to register, short enough not to linger and look stuck.
const SAVED_CONFIRMATION_MS = 2500;

// Mirrors setContext in src/store/monitored-contacts.ts, which stores the trimmed value (all-whitespace as null, surfaced here as '').
function normalizeContext(context: string): string {
  return context.trim();
}

// The caller mounts this with `key={contact.id}` so `message` resets by
// remounting on a new selection, rather than needing an effect to reset it.
export const ContactDetailPanel = forwardRef<ContactDetailPanelHandle, ContactDetailPanelProps>(function ContactDetailPanel(
  { contact, entry, onClose, onToggleMonitor, onRunCommand, onSetEscalation, onSetContext, onViewHistory },
  ref,
) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(() => new Set());
  const [contextDraft, setContextDraft] = useState(entry?.context ?? '');
  const [contextSaveState, setContextSaveState] = useState<ContextSaveState>('idle');
  const [contextError, setContextError] = useState<string | null>(null);
  // The last server value this draft was synced from — same "no unsaved
  // edit in progress" check SettingsPanel/PolicyEditor use, so a live
  // update from another tab never clobbers a draft in progress here.
  const lastSyncedContext = useRef(entry?.context ?? '');
  const savedConfirmationTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const savedContext = entry?.context ?? '';
  const contextDirty = normalizeContext(contextDraft) !== savedContext;

  useEffect(() => {
    if (normalizeContext(contextDraft) === lastSyncedContext.current) setContextDraft(savedContext);
    lastSyncedContext.current = savedContext;
  }, [savedContext]);

  useEffect(() => () => clearTimeout(savedConfirmationTimeout.current), []);

  async function saveContext(): Promise<boolean> {
    if (!contact) return false;
    setContextSaveState('saving');
    setContextError(null);
    try {
      await onSetContext(contact.id, contextDraft);
      setContextSaveState('saved');
      clearTimeout(savedConfirmationTimeout.current);
      savedConfirmationTimeout.current = setTimeout(() => setContextSaveState('idle'), SAVED_CONFIRMATION_MS);
      return true;
    } catch (err) {
      setContextSaveState('error');
      setContextError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      hasUnsavedChanges: () => contextDirty,
      save: saveContext,
      discard: () => {
        clearTimeout(savedConfirmationTimeout.current);
        setContextDraft(savedContext);
        setContextSaveState('idle');
        setContextError(null);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveContext closes over contact/contextDraft, which are already covered by contact/contextDirty below
    [contextDirty, savedContext, contact, contextDraft],
  );

  if (!contact) return null;

  const contactId = contact.id;
  const monitored = Boolean(entry);
  // Only blocks turning it ON: if it's already monitored (e.g. added while
  // TEST_ALLOW_SELF=1, then the env var got turned back off), the operator
  // must still be able to turn it back off — locking that too would strand
  // them with a switch they can see is on but can never touch.
  const selfBlocked = contact.isSelf && !contact.allowSelf && !monitored;

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
              selfBlocked
                ? "This is your own account — it can't be moderated. Set TEST_ALLOW_SELF=1 to test the pipeline against messages you send yourself."
                : contact.isSelf && !contact.allowSelf && monitored
                  ? 'This was enabled for self-testing (TEST_ALLOW_SELF=1) — you can turn it off, but re-enabling it needs that setting again.'
                  : monitored
                    ? undefined
                    : 'Start tracking strikes and enable auto-blocking for this contact.'
            }
            control={
              <Switch
                checked={monitored}
                disabled={pending.has('monitor') || selfBlocked}
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

        {monitored && (
          <section className="rounded-xl border border-border bg-card px-4 py-3.5">
            <p className="font-medium leading-6">Moderation context</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Extra guidance folded into the classifier prompt for this contact only, alongside the global policy — e.g. "this is my landlord, be lenient about payment disputes."
            </p>
            <Textarea
              id="moderation-context"
              className="mt-3"
              rows={3}
              placeholder="No extra context for this contact."
              value={contextDraft}
              disabled={contextSaveState === 'saving'}
              aria-describedby="moderation-context-status"
              onChange={(e) => {
                setContextDraft(e.target.value);
                if (contextSaveState === 'saved' || contextSaveState === 'error') setContextSaveState('idle');
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p id="moderation-context-status" aria-live="polite" className="flex min-h-[1.25em] items-center gap-1.5 text-sm text-muted-foreground">
                {contextSaveState === 'saving' && (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Saving…
                  </>
                )}
                {contextSaveState === 'saved' && 'Saved'}
                {contextSaveState === 'error' && (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <CircleAlert className="size-3.5" aria-hidden="true" />
                    Couldn't save{contextError ? `: ${contextError}` : ''}
                  </span>
                )}
                {contextSaveState === 'idle' && contextDirty && 'Unsaved changes'}
              </p>
              <Button size="sm" onClick={saveContext} disabled={!contextDirty || contextSaveState === 'saving'} aria-busy={contextSaveState === 'saving'}>
                {contextSaveState === 'saving' ? 'Saving…' : contextSaveState === 'error' ? 'Retry save' : 'Save'}
              </Button>
            </div>
          </section>
        )}
      </div>

      <p className="mt-4 min-h-[1.5em] text-sm text-muted-foreground">{message}</p>
    </div>
  );
});
