import { useEffect, useState } from 'react';
import { apiFetch } from './api';

export interface InstalledModel {
  name: string;
  sizeBytes: number;
}

// null means Ollama could not be asked, so the model fields fall back to free text instead of an empty picker.
export function useInstalledModels({ open }: { open: boolean }): InstalledModel[] | null {
  const [models, setModels] = useState<InstalledModel[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<{ models: InstalledModel[] }>('/api/ollama/models')
      .then((result) => !cancelled && setModels(result.models))
      .catch(() => !cancelled && setModels(null));
    return () => {
      cancelled = true;
    };
  }, [open]);

  return models;
}
