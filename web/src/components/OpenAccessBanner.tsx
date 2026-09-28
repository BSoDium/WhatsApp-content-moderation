import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

// Persistent and not dismissible: authRequired: false is a standing fact about the deployment.
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
