import type { ReactNode } from 'react';

// Android-settings-style row: title/subtitle left, one control flush right — shared by toggles and read-only stats so the panel lines up on one grid.
interface SettingRowProps {
  title: string;
  description?: string;
  control: ReactNode;
}

export function SettingRow({ title, description, control }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}
