import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ContactAvatar } from './ContactAvatar';
import { SelfModerationNotice } from './SelfModerationNotice';
import { SettingRow } from './SettingRow';
import { moderationState, relativeTime } from '@/lib/contact';
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
  onSetCallNuisanceThreshold: (contactId: string, threshold: number | null) => Promise<true>;
  onViewHistory: (contactId: string) => void;
}

// Lets App.tsx check for unsaved state before a remount would silently lose the moderation-context draft.
export interface ContactDetailPanelHandle {
  hasUnsavedChanges: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

type FieldSaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVED_CONFIRMATION_MS = 2500;

// Mirrors setContext in src/store/monitored-contacts.ts, which stores the trimmed value (all-whitespace as null, surfaced here as '').
function normalizeContext(context: string): string {
  return context.trim();
}

interface CallNuisanceThresholdFieldProps {
  contactId: string;
  thresholdOverride: number | null;
  // The *effective* threshold (override ?? global default) — only usable as "the current default" in the placeholder/description when no override is set; once one is set this no longer reflects the global value at all, and the roster API doesn't separately expose the raw global setting.
  effectiveThreshold: number;
  disabled: boolean;
  onSave: (contactId: string, threshold: number | null) => Promise<true>;
}

// A single-field, save-on-blur override (empty = "use the global default"), simpler than the moderation-context textarea above: one atomic value, no multi-line draft worth guarding against an accidental navigate-away.
function CallNuisanceThresholdField({ contactId, thresholdOverride, effectiveThreshold, disabled, onSave }: CallNuisanceThresholdFieldProps) {
  const [draft, setDraft] = useState(thresholdOverride !== null ? String(thresholdOverride) : '');
  const lastSynced = useRef(thresholdOverride);
  const [saveState, setSaveState] = useState<FieldSaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const savedConfirmationTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (lastSynced.current === thresholdOverride) return;
    lastSynced.current = thresholdOverride;
    setDraft(thresholdOverride !== null ? String(thresholdOverride) : '');
  }, [thresholdOverride]);

  useEffect(() => () => clearTimeout(savedConfirmationTimeout.current), []);

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 0)) {
      setError('Must be a non-negative whole number, or empty to use the default.');
      return;
    }
    if (next === lastSynced.current) return;
    setError(null);
    setSaveState('saving');
    try {
      await onSave(contactId, next);
      lastSynced.current = next;
      setSaveState('saved');
      clearTimeout(savedConfirmationTimeout.current);
      savedConfirmationTimeout.current = setTimeout(() => setSaveState('idle'), SAVED_CONFIRMATION_MS);
    } catch (err) {
      setSaveState('idle');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const description =
    thresholdOverride === null
      ? `Unanswered calls tolerated before further calls are flagged. Empty uses the global default (currently ${effectiveThreshold}).`
      : 'Unanswered calls tolerated before further calls are flagged. Empty uses the global default.';

  return (
    <SettingRow
      title="Nuisance call threshold"
      description={description}
      control={
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            step={1}
            placeholder={String(effectiveThreshold)}
            className="w-20"
            value={draft}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onBlur={commit}
          />
          {saveState === 'saving' && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
          {saveState === 'saved' && <span className="text-xs text-muted-foreground">Saved</span>}
        </div>
      }
      error={error}
    />
  );
}

// Mounted with `key={contact.id}` so `message` resets on a new selection.
export const ContactDetailPanel = forwardRef<ContactDetailPanelHandle, ContactDetailPanelProps>(function ContactDetailPanel(
  { contact, entry, onClose, onToggleMonitor, onRunCommand, onSetEscalation, onSetContext, onSetCallNuisanceThreshold, onViewHistory },
  ref,
) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(() => new Set());
  const [contextDraft, setContextDraft] = useState(entry?.context ?? '');
  const [contextSaveState, setContextSaveState] = useState<FieldSaveState>('idle');
  const [contextError, setContextError] = useState<string | null>(null);
  // Same synced-value check as SettingsPanel/PolicyEditor, so a live update never clobbers a draft.
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
  const { strikeCount, block } = moderationState(contact, entry);
  const hasStrikes = strikeCount > 0 || (entry?.callNuisance.strikeCount ?? 0) > 0;
  // Only blocks turning it ON: an already-monitored self (TEST_ALLOW_SELF turned back off) must stay switch-off-able.
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

      {selfBlocked ? (
        <SelfModerationNotice />
      ) : (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-muted/40 px-4">
            <SettingRow
              title="Moderate this contact"
              description={
                contact.isSelf && !contact.allowSelf && monitored
                  ? 'This was enabled for self-testing (TEST_ALLOW_SELF=1) — you can turn it off, but re-enabling it needs that setting again.'
                  : monitored
                    ? undefined
                    : 'Start tracking strikes and enable auto-blocking for this contact.'
              }
              control={
                <Switch
                  checked={monitored}
                  disabled={pending.has('monitor')}
                  onCheckedChange={(checked) => withPending('monitor', () => onToggleMonitor(contact.id, checked))}
                />
              }
            />
          </section>

          <section className="rounded-xl border border-border bg-card px-4">
            <SettingRow
              title="Strikes"
              description={hasStrikes ? 'Reset after unblocking. Also clears call strikes.' : undefined}
              control={
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{strikeCount}</span>
                  <Button variant="outline" size="sm" disabled={!hasStrikes || pending.has('reset-strikes')} onClick={() => withPending('reset-strikes', () => runAndReport('reset-strikes'))}>
                    Reset
                  </Button>
                </div>
              }
            />
            <Separator />
            <SettingRow
              title="Block"
              description={block ? `Until ${formatTimestamp(block.unblockAt)}` : undefined}
              control={
                block ? (
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
              title="Nuisance calls"
              description="Call strikes toward auto-block, and unanswered calls since the last one that got through."
              control={
                <span className="tabular-nums">
                  {entry?.callNuisance.strikeCount ?? 0} strikes · {entry?.callNuisance.unansweredCount ?? 0} unanswered
                </span>
              }
            />
            <Separator />
            <CallNuisanceThresholdField
              contactId={contact.id}
              thresholdOverride={entry?.callNuisance.thresholdOverride ?? null}
              effectiveThreshold={entry?.callNuisance.threshold ?? 0}
              disabled={!monitored}
              onSave={onSetCallNuisanceThreshold}
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
                Extra guidance folded into the classifier prompt for this contact only, alongside the global policy. Be concrete: name the topics, words or requests to flag, e.g. "flag any mention of my mother (mom, maman) or requests to contact her." Vague rules are easy for a small model to miss."
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
      )}

      <p className="mt-4 min-h-[1.5em] text-sm text-muted-foreground">{message}</p>
    </div>
  );
});
