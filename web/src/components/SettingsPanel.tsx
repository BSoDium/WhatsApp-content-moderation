import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ErrorBanner } from './ErrorBanner';
import { SettingRow } from './SettingRow';
import { useSettingsList } from '@/lib/useSettings';
import type { Setting } from '@/lib/types';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SECTION_TITLES: Record<Setting['section'], string> = {
  general: 'General',
  classifier: 'Classifier',
  warning: 'Warning messages',
  strikes: 'Strikes & blocking',
};

const SECTION_ORDER: Setting['section'][] = ['general', 'classifier', 'warning', 'strikes'];

// How long the "Saved" confirmation stays up before fading back to idle —
// same value ContactDetailPanel uses for the same kind of confirmation.
const SAVED_CONFIRMATION_MS = 2500;

type FieldSaveState = 'idle' | 'saving' | 'saved';

// A fixed-size slot so a field's layout doesn't shift as this icon appears
// and disappears; the sr-only text is what actually tells a screen-reader
// user a save happened, since the icon itself is decorative.
function SaveStatusIcon({ state }: { state: FieldSaveState }) {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground" aria-live="polite">
      {state === 'saving' && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
      {state === 'saved' && <Check className="size-3.5" aria-hidden="true" />}
      <span className="sr-only">{state === 'saving' ? 'Saving' : state === 'saved' ? 'Saved' : ''}</span>
    </span>
  );
}

// Mirrors validateValue() in src/store/settings.ts — an inline check before
// the round-trip, not a replacement for the server's own authoritative one.
function clientValidationError(setting: Setting, raw: string): string | undefined {
  if (setting.type === 'string') {
    if (setting.required && raw.trim() === '') return `${setting.label} must not be empty`;
    return undefined;
  }
  const num = Number(raw);
  if (raw.trim() === '' || Number.isNaN(num) || !Number.isFinite(num)) return `${setting.label} must be a number`;
  if (setting.type === 'int' && !Number.isInteger(num)) return `${setting.label} must be an integer`;
  if (setting.min !== undefined && num < setting.min) return `${setting.label} must be at least ${setting.min}`;
  return undefined;
}

interface SettingFieldProps {
  setting: Setting;
  pending: boolean;
  onSave: (key: string, value: string) => Promise<boolean>;
  onValidationChange: (key: string, error: string | undefined) => void;
}

// Local draft + save-on-blur, only when the value actually changed — a
// blur that didn't change anything (tab-through, click-away) shouldn't fire
// a request, and each row's own pending state never disables another row.
function SettingField({ setting, pending, onSave, onValidationChange }: SettingFieldProps) {
  const [draft, setDraft] = useState(setting.value);
  // The last server value this draft was synced from — lets the effect
  // below tell "no local edit since the last sync" apart from "an unsaved
  // edit is in progress," instead of unconditionally overwriting the input.
  const lastSyncedValue = useRef(setting.value);
  const [saveState, setSaveState] = useState<FieldSaveState>('idle');
  const savedConfirmationTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Applies a live update (e.g. another tab editing the same setting) only
  // when there's no unsaved local edit in this field.
  useEffect(() => {
    if (draft === lastSyncedValue.current) setDraft(setting.value);
    lastSyncedValue.current = setting.value;
  }, [setting.value]);

  useEffect(() => () => clearTimeout(savedConfirmationTimeout.current), []);

  async function commit(next: string) {
    setSaveState('saving');
    const ok = await onSave(setting.key, next);
    // A value the server rejected was never actually applied — revert so
    // the field doesn't keep showing invalid, unsaved text with no other
    // indication that the edit didn't take.
    const synced = ok ? next : setting.value;
    lastSyncedValue.current = synced;
    setDraft(synced);
    if (!ok) {
      setSaveState('idle');
      return;
    }
    setSaveState('saved');
    clearTimeout(savedConfirmationTimeout.current);
    savedConfirmationTimeout.current = setTimeout(() => setSaveState('idle'), SAVED_CONFIRMATION_MS);
  }

  if (setting.type === 'bool') {
    return (
      <div className="flex items-center gap-2">
        <Switch
          checked={draft === '1'}
          disabled={pending}
          onCheckedChange={(checked) => {
            const next = checked ? '1' : '0';
            setDraft(next);
            commit(next);
          }}
        />
        <SaveStatusIcon state={saveState} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={draft}
        type={setting.type === 'string' ? 'text' : 'number'}
        step={setting.type === 'float' ? 'any' : undefined}
        min={setting.min}
        disabled={pending}
        className="w-40"
        onChange={(e) => {
          setDraft(e.target.value);
          onValidationChange(setting.key, undefined);
        }}
        onBlur={() => {
          if (draft === setting.value) return;
          const validationError = clientValidationError(setting, draft);
          // Caught here instead of round-tripped to the server: the field
          // keeps the invalid draft (so it's there to fix) rather than
          // reverting it, and no request fires for a value that can't
          // possibly be accepted.
          onValidationChange(setting.key, validationError);
          if (validationError) return;
          commit(draft);
        }}
      />
      <SaveStatusIcon state={saveState} />
    </div>
  );
}

// Remounted via a `key` in App.tsx (same pattern as ActivityPanel).
export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { settings, loading, error, pendingKeys, refresh, save } = useSettingsList({ open });
  const [validationErrors, setValidationErrors] = useState<Record<string, string | undefined>>({});

  function setValidationError(key: string, validationError: string | undefined) {
    setValidationErrors((prev) => (prev[key] === validationError ? prev : { ...prev, [key]: validationError }));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        size="wide"
        className="gap-0"
        aria-describedby="settings-panel-description"
        resizable={{ id: 'settings-panel', defaultWidth: 640, min: 420, max: 900, label: 'Resize settings panel' }}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription id="settings-panel-description">
            Tuning knobs for the classifier and moderation pipeline. Changes apply immediately, no restart needed.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {error && <ErrorBanner error={{ ...error, retry: refresh }} onDismiss={() => {}} />}
          {!loading &&
            SECTION_ORDER.map((section) => {
              const sectionSettings = settings.filter((s) => s.section === section);
              if (sectionSettings.length === 0) return null;
              return (
                <section key={section} className="rounded-xl border border-border bg-card px-4">
                  <p className="pt-3.5 text-sm font-medium text-muted-foreground">{SECTION_TITLES[section]}</p>
                  {sectionSettings.map((setting, i) => (
                    <div key={setting.key}>
                      {i > 0 && <Separator />}
                      <SettingRow
                        title={setting.label}
                        description={setting.description}
                        control={<SettingField setting={setting} pending={pendingKeys.has(setting.key)} onSave={save} onValidationChange={setValidationError} />}
                        error={validationErrors[setting.key]}
                      />
                    </div>
                  ))}
                </section>
              );
            })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
