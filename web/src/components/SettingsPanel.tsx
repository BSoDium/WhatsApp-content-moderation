import { useEffect, useRef, useState } from 'react';
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

interface SettingFieldProps {
  setting: Setting;
  pending: boolean;
  onSave: (key: string, value: string) => Promise<boolean>;
}

// Local draft + save-on-blur, only when the value actually changed — a
// blur that didn't change anything (tab-through, click-away) shouldn't fire
// a request, and each row's own pending state never disables another row.
function SettingField({ setting, pending, onSave }: SettingFieldProps) {
  const [draft, setDraft] = useState(setting.value);
  // The last server value this draft was synced from — lets the effect
  // below tell "no local edit since the last sync" apart from "an unsaved
  // edit is in progress," instead of unconditionally overwriting the input.
  const lastSyncedValue = useRef(setting.value);

  // Applies a live update (e.g. another tab editing the same setting) only
  // when there's no unsaved local edit in this field.
  useEffect(() => {
    if (draft === lastSyncedValue.current) setDraft(setting.value);
    lastSyncedValue.current = setting.value;
  }, [setting.value]);

  if (setting.type === 'bool') {
    return (
      <Switch
        checked={draft === '1'}
        disabled={pending}
        onCheckedChange={async (checked) => {
          const next = checked ? '1' : '0';
          setDraft(next);
          const ok = await onSave(setting.key, next);
          const synced = ok ? next : setting.value;
          lastSyncedValue.current = synced;
          setDraft(synced);
        }}
      />
    );
  }

  return (
    <Input
      value={draft}
      type={setting.type === 'string' ? 'text' : 'number'}
      step={setting.type === 'float' ? 'any' : undefined}
      disabled={pending}
      className="w-40"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        if (draft === setting.value) return;
        const ok = await onSave(setting.key, draft);
        // A value the server rejected was never actually applied — revert
        // so the field doesn't keep showing invalid, unsaved text with no
        // other indication that the edit didn't take.
        const synced = ok ? draft : setting.value;
        lastSyncedValue.current = synced;
        setDraft(synced);
      }}
    />
  );
}

// Remounted via a `key` in App.tsx (same pattern as ActivityPanel).
export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { settings, loading, error, pendingKeys, refresh, save } = useSettingsList({ open });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="wide" className="gap-0" aria-describedby="settings-panel-description">
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
                        control={<SettingField setting={setting} pending={pendingKeys.has(setting.key)} onSave={save} />}
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
