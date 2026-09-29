import { useEffect, useRef, useState } from 'react';
import { Check, Info, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ErrorBanner } from './ErrorBanner';
import { SettingRow } from './SettingRow';
import { useSettingsList, type SaveStatus } from '@/lib/useSettings';
import type { Setting } from '@/lib/types';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skipInitialAnimation?: boolean;
}

const SECTION_TITLES: Record<Setting['section'], string> = {
  general: 'General',
  classifier: 'Classifier',
  warning: 'Warning messages',
  strikes: 'Strikes & blocking',
  calls: 'Nuisance calls',
};

const SECTION_ORDER: Setting['section'][] = ['general', 'classifier', 'warning', 'strikes', 'calls'];

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  return (
    <span className="flex h-5 items-center gap-1.5 text-sm text-muted-foreground">
      {status === 'idle' && (
        <>
          <Info className="size-4" aria-hidden="true" />
          Changes are saved automatically
        </>
      )}
      <span className="flex items-center gap-1.5" aria-live="polite">
        {status === 'saving' && (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Saving
          </>
        )}
        {status === 'saved' && (
          <>
            <Check className="size-4" aria-hidden="true" />
            Saved
          </>
        )}
      </span>
    </span>
  );
}

// Mirrors validateValue() in src/store/settings.ts; the server's check stays authoritative.
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

function SettingField({ setting, pending, onSave, onValidationChange }: SettingFieldProps) {
  const [draft, setDraft] = useState(setting.value);
  const lastSyncedValue = useRef(setting.value);

  // A live update from elsewhere only applies while there's no unsaved local edit.
  useEffect(() => {
    if (draft === lastSyncedValue.current) setDraft(setting.value);
    lastSyncedValue.current = setting.value;
  }, [setting.value]);

  async function commit(next: string) {
    const ok = await onSave(setting.key, next);
    // A rejected value was never applied, so revert instead of leaving invalid text with no other sign the edit failed.
    const synced = ok ? next : setting.value;
    lastSyncedValue.current = synced;
    setDraft(synced);
  }

  if (setting.type === 'bool') {
    return (
      <Switch
        checked={draft === '1'}
        disabled={pending}
        onCheckedChange={(checked) => {
          const next = checked ? '1' : '0';
          setDraft(next);
          commit(next);
        }}
      />
    );
  }

  return (
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
        onValidationChange(setting.key, validationError);
        if (validationError) return;
        commit(draft);
      }}
    />
  );
}

export function SettingsPanel({ open, onOpenChange, skipInitialAnimation }: SettingsPanelProps) {
  const { settings, loading, error, pendingKeys, saveStatus, refresh, save } = useSettingsList({ open });
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
        skipInitialAnimation={skipInitialAnimation}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription id="settings-panel-description" asChild>
            <div>
              <SaveStatusIndicator status={saveStatus} />
            </div>
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
