import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pullCommand } from '@/lib/modelSettings';

const COPIED_FEEDBACK_MS = 2000;

export function MissingModelHint({ model }: { model: string }) {
  const [copied, setCopied] = useState(false);
  const command = pullCommand(model);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2">
      <span>Not installed on this Ollama. Run</span>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{command}</code>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Copy command" onClick={copy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}
