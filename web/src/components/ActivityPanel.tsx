import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatsCards } from './StatsCards';
import { MessageExplorer } from './MessageExplorer';
import { ErrorBanner } from './ErrorBanner';
import { useActivityData } from '@/lib/useActivityData';
import type { Contact } from '@/lib/types';

interface ActivityPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContactId: string | null;
  contacts: Contact[];
}

// Remounted (via a `key` in App.tsx that changes every time it's opened) so
// its filters and scroll position always start fresh — the same pattern
// ContactDetailPanel already uses to reset its own local state on selection.
export function ActivityPanel({ open, onOpenChange, initialContactId, contacts }: ActivityPanelProps) {
  const { stats, entries, nextBefore, loading, loadingMore, error, contactId, setContactId, action, setAction, searchInput, setSearchInput, refresh, loadMore } =
    useActivityData({ open, initialContactId });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full! gap-0 sm:max-w-2xl! md:max-w-3xl!" aria-describedby="activity-panel-description">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Moderation activity</SheetTitle>
          <SheetDescription id="activity-panel-description">
            Stats and a full record of every message this system classified, warned about, or deleted — filters below apply to the table only.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {error && <ErrorBanner error={{ title: 'Could not load activity', description: error, retry: refresh }} onDismiss={() => {}} />}
          <StatsCards stats={stats} />
          <MessageExplorer
            contacts={contacts}
            entries={entries}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={nextBefore !== null}
            contactId={contactId}
            onContactIdChange={setContactId}
            action={action}
            onActionChange={setAction}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            onLoadMore={loadMore}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
