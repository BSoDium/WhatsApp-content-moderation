import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

// Shown whenever GET /api/meta reports authRequired: false — this instance
// has no ALLOWED_TAILSCALE_LOGIN set, so src/web/control-server.ts is
// reachable, unauthenticated, by anyone who can reach the host on this
// port (its whole local network, by default). Persistent, not dismissible —
// this is a standing fact about the deployment, not a one-off event.
export function OpenAccessBanner() {
  return (
    <Alert variant="destructive">
      <AlertTitle>This control app is not access-restricted</AlertTitle>
      <AlertDescription>
        No ALLOWED_TAILSCALE_LOGIN is set, so anyone who can reach this device on your local network can open this page and change moderation settings. Set ALLOWED_TAILSCALE_LOGIN and proxy this app through{' '}
        <code>tailscale serve</code> to restrict access — see the README.
      </AlertDescription>
    </Alert>
  );
}
