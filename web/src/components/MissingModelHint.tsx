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
    <span className="flex flex-col items-end gap-2 pt-1.5">
      <span>Not installed on this Ollama. Run:</span>
      <span className="inline-flex max-w-full items-center gap-1 rounded-lg bg-muted py-0.5 pl-2 pr-0.5 font-mono text-foreground">
        <code className="min-w-0 break-all">{command}</code>
        <Button type="button" variant="ghost" size="icon-xs" className="text-foreground/50 hover:bg-transparent hover:text-foreground" aria-label="Copy command" onClick={copy}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </span>
    </span>
  );
}
