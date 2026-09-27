import { Loader2, SearchX } from 'lucide-react';
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

      <div className="rounded-xl border border-border">
        {/* table-fixed + an explicit width on every column but Message: in the
            browser's default auto layout, a cell's max-w/min-w are only hints —
            long unwrapped content (e.g. the "Classifier error" badge) can still
            force the whole table wider than its container, which the outer
            overflow-x-auto then lets you scroll into instead of actually
            wrapping. Fixed layout makes the header row the sole source of
            truth for column widths, so Message reliably gets what's left. */}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="hidden sm:w-32 sm:table-cell">When</TableHead>
              <TableHead className="hidden sm:w-28 sm:table-cell">Contact</TableHead>
              <TableHead className="w-28 sm:w-32">Action</TableHead>
              <TableHead>Message</TableHead>
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
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{formatTimestamp(entry.createdAt)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className="max-w-28 truncate">{entry.contactName}</span>
                  </TableCell>
                  <TableCell>
                    <ActionBadge action={entry.action} />
                  </TableCell>
                  <TableCell className="min-w-0 whitespace-normal">
                    <p className="text-xs text-muted-foreground sm:hidden">
                      {entry.contactName} · {formatTimestamp(entry.createdAt)}
                    </p>
                    <p className="line-clamp-2 break-words">{entry.message}</p>
                    {entry.reason && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
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
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore} className="self-center">
          {loadingMore && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Load more
        </Button>
      )}
    </div>
  );
}
