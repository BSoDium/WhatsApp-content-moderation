import { useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const REPOSITORY_URL = 'https://github.com/BSoDium/WhatsApp-content-moderation';

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div role="note" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-popover py-1.5 pr-1.5 pl-3 text-sm text-popover-foreground shadow-lg">
        <Badge variant="secondary">Live demo</Badge>
        <span className="min-w-0 truncate">Every name, message and number here is fake, and it resets on reload.</span>
        <Button variant="link" size="sm" asChild>
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            Source
          </a>
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          <X />
        </Button>
      </div>
    </div>
  );
}
