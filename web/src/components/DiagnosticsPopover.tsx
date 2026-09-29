import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { SignedInUser } from '@/components/SignedInUser';
import { formatElapsed } from '@/lib/duration';
import type { ServerStatus, SignedInUser as SignedInUserData, WhatsAppStatus } from '@/lib/types';
import { useNow } from '@/lib/useNow';
import { useServerStatus } from '@/lib/useServerStatus';

const CLOCK_TICK_MS = 1000;

interface DiagnosticsPopoverProps {
  user: SignedInUserData;
  lastRefreshedAt: number | null;
  streamLive: boolean;
}

interface WhatsAppLabel {
  label: string;
  variant: 'default' | 'secondary' | 'destructive';
}

const WHATSAPP_LABELS: Record<WhatsAppStatus, WhatsAppLabel> = {
  open: { label: 'Connected', variant: 'default' },
  connecting: { label: 'Connecting', variant: 'secondary' },
  reconnecting: { label: 'Reconnecting', variant: 'secondary' },
  'logged-out': { label: 'Logged out', variant: 'destructive' },
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function WhatsAppRow({ status, now }: { status: ServerStatus['whatsapp']; now: number }) {
  const { label, variant } = WHATSAPP_LABELS[status.status];
  return (
    <Row label="WhatsApp">
      <span className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">{formatElapsed(now - status.since)}</span>
        <Badge variant={variant}>{label}</Badge>
      </span>
    </Row>
  );
}

function DiagnosticsBody({ user, lastRefreshedAt, streamLive }: DiagnosticsPopoverProps) {
  const { status, failed, clockSkewMs } = useServerStatus();
  const localNow = useNow(CLOCK_TICK_MS);
  const now = localNow + clockSkewMs;

  return (
    <>
      <PopoverHeader>
        <PopoverTitle>{user.name}</PopoverTitle>
        <PopoverDescription className="truncate">{user.login}</PopoverDescription>
      </PopoverHeader>
      <Separator />
      <dl className="flex flex-col gap-2 text-sm">
        {user.tailnet && (
          <Row label="Tailnet">
            <span className="truncate font-mono text-xs">{user.tailnet}</span>
          </Row>
        )}
        {status && <WhatsAppRow status={status.whatsapp} now={now} />}
        <Row label="Live updates">
          <Badge variant={streamLive ? 'default' : 'secondary'}>{streamLive ? 'Streaming' : 'Polling'}</Badge>
        </Row>
        <Row label="Last refresh">
          <span className="tabular-nums">{lastRefreshedAt ? `${formatElapsed(localNow - lastRefreshedAt)} ago` : '—'}</span>
        </Row>
        {status && (
          <>
            <Row label="Uptime">
              <span className="tabular-nums">{formatElapsed(now - status.startedAt)}</span>
            </Row>
            <Row label="Version">
              <span className="font-mono text-xs">{status.version}</span>
            </Row>
          </>
        )}
      </dl>
      {failed && <p className="text-xs text-destructive">Couldn't reach the server for a status update.</p>}
    </>
  );
}

export function DiagnosticsPopover(props: DiagnosticsPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="-mr-1.5 h-auto max-w-full min-w-0 justify-start rounded-lg p-1.5 font-normal lg:mr-0 lg:-ml-1.5" aria-label={`${props.user.name} — session and diagnostics`}>
          <SignedInUser user={props.user} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <DiagnosticsBody {...props} />
      </PopoverContent>
    </Popover>
  );
}
