import { Loader2, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionBadge } from './ActionBadge';
import { ACTION_FILTER_OPTIONS, actionMeta, formatCategory, formatTimestamp } from '@/lib/activity';
import type { AuditLogEntry, Contact } from '@/lib/types';

const ALL_CONTACTS = 'all';
const ALL_ACTIONS = 'all';
const SKELETON_ROW_COUNT = 6;
// Keyed to the table's own width, not the viewport: the sheet is resizable, so a wide screen can still host a narrow table.
const WIDE_COLUMNS_SHOWN = '@[44rem]:table-cell';
const WIDE_COLUMNS_HIDDEN = '@[44rem]:hidden';

interface MessageExplorerProps {
  contacts: Contact[];
  entries: AuditLogEntry[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  contactId: string;
  onContactIdChange: (contactId: string) => void;
  action: string;
  onActionChange: (action: string) => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onLoadMore: () => void;
}

export function MessageExplorer({
  contacts,
  entries,
  loading,
  loadingMore,
  hasMore,
  contactId,
  onContactIdChange,
  action,
  onActionChange,
  searchInput,
  onSearchInputChange,
  onLoadMore,
}: MessageExplorerProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Select value={contactId || ALL_CONTACTS} onValueChange={(value) => onContactIdChange(value === ALL_CONTACTS ? '' : value)}>
          <SelectTrigger aria-label="Filter by contact" className="w-full sm:w-auto sm:min-w-36">
            <SelectValue placeholder="All contacts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CONTACTS}>All contacts</SelectItem>
            {contacts.map((contact) => (
              <SelectItem key={contact.id} value={contact.id}>
                {contact.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={action || ALL_ACTIONS} onValueChange={(value) => onActionChange(value === ALL_ACTIONS ? '' : value)}>
          <SelectTrigger aria-label="Filter by action" className="w-full sm:w-auto sm:min-w-32">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ACTIONS}>All actions</SelectItem>
            {ACTION_FILTER_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {actionMeta(value).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="search"
          placeholder="Search message text…"
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          className="col-span-2 sm:min-w-40 sm:flex-1"
          aria-label="Search message text"
        />
      </div>

      <div className="@container rounded-xl border border-border">
        {/* table-fixed with explicit column widths: in auto layout, long unwrapped cells force the table wider than its container instead of wrapping. */}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className={cn('hidden w-44 px-4', WIDE_COLUMNS_SHOWN)}>When</TableHead>
              <TableHead className={cn('hidden w-36 px-4', WIDE_COLUMNS_SHOWN)}>Contact</TableHead>
              <TableHead className="w-40 px-4">Action</TableHead>
              <TableHead className="px-4">Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {!loading && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <SearchX className="size-5" aria-hidden="true" />
                    <span>No activity matches these filters.</span>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className={cn('hidden truncate px-4 text-xs text-muted-foreground', WIDE_COLUMNS_SHOWN)} title={formatTimestamp(entry.createdAt)}>
                    {formatTimestamp(entry.createdAt)}
                  </TableCell>
                  <TableCell className={cn('hidden truncate px-4', WIDE_COLUMNS_SHOWN)} title={entry.contactName}>
                    {entry.contactName}
                  </TableCell>
                  <TableCell className="overflow-hidden px-4">
                    <ActionBadge action={entry.action} />
                  </TableCell>
                  <TableCell className="min-w-0 overflow-hidden px-4 whitespace-normal">
                    <p className={cn('truncate text-xs text-muted-foreground', WIDE_COLUMNS_HIDDEN)}>
                      {entry.contactName} · {formatTimestamp(entry.createdAt)}
                    </p>
                    <p className="line-clamp-2 break-words">{entry.message}</p>
                    {entry.reason && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={entry.reason}>
                        {entry.category && entry.category !== 'none' ? `${formatCategory(entry.category)} — ` : ''}
                        {entry.reason}
                      </p>
                    )}
                    {entry.error && <p className="mt-0.5 truncate text-xs text-destructive">{entry.error}</p>}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore || loading} className="self-center">
          {loadingMore && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Load more
        </Button>
      )}
    </div>
  );
}
