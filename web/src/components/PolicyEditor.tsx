import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from './ErrorBanner';
import { usePolicy } from '@/lib/useSettings';

interface PolicyEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skipInitialAnimation?: boolean;
}

export function PolicyEditor({ open, onOpenChange, skipInitialAnimation }: PolicyEditorProps) {
  const { text, loading, saving, error, refresh, save } = usePolicy({ open });
  const [draft, setDraft] = useState(text);
  // The last server text this draft synced from, to tell "no local edit" from "edit in progress".
  const lastSyncedText = useRef(text);

  // A live update only applies when there's no unsaved local edit.
  useEffect(() => {
    if (draft === lastSyncedText.current) setDraft(text);
    lastSyncedText.current = text;
  }, [text]);

  const dirty = draft !== text;

  async function handleSave() {
    if (await save(draft)) {
      lastSyncedText.current = draft.trim();
      setDraft(draft.trim());
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        size="wide"
        className="gap-0"
        aria-describedby="policy-editor-description"
        resizable={{ id: 'policy-editor', defaultWidth: 640, min: 420, max: 1000, label: 'Resize policy editor' }}
        skipInitialAnimation={skipInitialAnimation}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>Moderation policy</SheetTitle>
          <SheetDescription id="policy-editor-description">
            The rules every message is judged against, across every monitored contact. Add contact-specific nuance from that contact's own detail panel instead of here.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {error && <ErrorBanner error={{ ...error, retry: refresh }} onDismiss={() => {}} />}
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
