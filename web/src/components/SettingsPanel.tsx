import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
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
  classifier: 'Classifier',
  warning: 'Warning messages',
  strikes: 'Strikes & blocking',
};

const SECTION_ORDER: Setting['section'][] = ['classifier', 'warning', 'strikes'];

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

  useEffect(() => {
    setDraft(setting.value);
  }, [setting.value]);

  return (
    <Input
      value={draft}
      type={setting.type === 'string' ? 'text' : 'number'}
      step={setting.type === 'float' ? 'any' : undefined}
      disabled={pending}
      className="w-40"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== setting.value) onSave(setting.key, draft);
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
          {error && <ErrorBanner error={{ title: 'Could not load settings', description: error, retry: refresh }} onDismiss={() => {}} />}
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
