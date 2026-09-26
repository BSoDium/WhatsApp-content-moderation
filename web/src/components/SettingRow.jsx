// Android-settings-style row: title (+ optional subtitle) on the left,
// a single control flush right — reused for both toggles and read-only
// stats so the whole panel lines up on one consistent grid.
export function SettingRow({ title, description, control }) {
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
