import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const README_AUTH_URL = 'https://github.com/BSoDium/WhatsApp-content-moderation#auth-model';

// Persistent and not dismissible: authRequired: false is a standing fact about the deployment.
export function DirectAccessWarning() {
  return (
    <Alert className="border-warning/45 bg-warning/10 text-warning *:[svg]:row-span-1 *:[svg]:translate-y-0 *:[svg]:self-center *:data-[slot=alert-description]:text-foreground/80">
      <ShieldAlert strokeWidth={2} className="size-4" />
      <AlertTitle className="text-sm leading-tight font-semibold">Not access-restricted</AlertTitle>
      <AlertDescription className="col-start-2 mt-0.5 text-xs">
        You're connected directly, without Tailscale, so anyone on your network can open this page.{' '}
        <a href={README_AUTH_URL} target="_blank" rel="noreferrer">
          Learn more
        </a>
      </AlertDescription>
    </Alert>
  );
}
