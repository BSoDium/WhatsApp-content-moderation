import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Persistent and not dismissible: authRequired: false is a standing fact about the deployment.
export function DirectAccessWarning() {
  return (
    <Alert className="border-warning/45 bg-warning/10 text-warning *:data-[slot=alert-description]:text-foreground/80">
      <ShieldAlert />
      <AlertTitle>Anyone on your network can open this</AlertTitle>
      <AlertDescription>
        You're connected directly, without Tailscale. No ALLOWED_TAILSCALE_LOGIN is set, so anyone who can reach this device can change moderation settings. Set it and proxy this app through <code>tailscale serve</code> to
        restrict access — see the README.
      </AlertDescription>
    </Alert>
  );
}
