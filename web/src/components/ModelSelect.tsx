import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { InstalledModel } from '@/lib/useInstalledModels';

// Radix Select forbids an empty item value, so "inherit the classifier model" travels as this sentinel.
const INHERIT = '__inherit__';
const BYTES_PER_GB = 1024 ** 3;

interface ModelSelectProps {
  value: string;
  models: InstalledModel[];
  inheritsClassifier: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}

function formatSize(bytes: number): string {
  return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
}

export function ModelSelect({ value, models, inheritsClassifier, disabled, onChange }: ModelSelectProps) {
  const isMissing = value !== '' && !models.some((model) => model.name === value);

  return (
    <Select value={value === '' && inheritsClassifier ? INHERIT : value} disabled={disabled} onValueChange={(next) => onChange(next === INHERIT ? '' : next)}>
      <SelectTrigger className="w-56" aria-label="Model">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {inheritsClassifier && <SelectItem value={INHERIT}>Same as classifier</SelectItem>}
        {isMissing && <SelectItem value={value}>{value} (not installed)</SelectItem>}
        {models.map((model) => (
          <SelectItem key={model.name} value={model.name}>
            {model.name} · {formatSize(model.sizeBytes)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
