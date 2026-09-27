import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from './ErrorBanner';
import { usePolicy } from '@/lib/useSettings';

interface PolicyEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Remounted via a `key` in App.tsx (same pattern as ActivityPanel) so a
// discarded draft never carries over to the next time this opens.
export function PolicyEditor({ open, onOpenChange }: PolicyEditorProps) {
  const { text, loading, saving, error, refresh, save } = usePolicy({ open });
  const [draft, setDraft] = useState(text);

  // Only overwrite the draft when the server text first arrives or changes
  // out from under us (an SSE-driven refresh) — not on every render, or a
  // keystroke would keep getting clobbered by the still-in-flight fetch.
  useEffect(() => {
    setDraft(text);
  }, [text]);

  const dirty = draft !== text;

  async function handleSave() {
    if (await save(draft)) setDraft(draft.trim());
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="wide" className="gap-0" aria-describedby="policy-editor-description">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Moderation policy</SheetTitle>
          <SheetDescription id="policy-editor-description">
            The rules every message is judged against, across every monitored contact. Add contact-specific nuance from that contact's own detail panel instead of here.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {error && <ErrorBanner error={{ title: 'Could not load the policy', description: error, retry: refresh }} onDismiss={() => {}} />}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={loading}
            rows={16}
            className="min-h-[50vh] flex-1 font-mono text-sm"
            placeholder="Flag anything that..."
          />
          <div className="flex items-center justify-end gap-3">
            {dirty && <p className="text-sm text-muted-foreground">Unsaved changes</p>}
            <Button onClick={handleSave} disabled={!dirty || saving || draft.trim().length === 0}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
