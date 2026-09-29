import { Alert, AlertTitle, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface ShadowModeBannerProps {
  onOpenSettings: () => void;
}

// Persistent and not dismissible: shadow mode silently disables every action, so it must stay visible until switched off.
export function ShadowModeBanner({ onOpenSettings }: ShadowModeBannerProps) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Shadow mode is on — moderation is not active</AlertTitle>
      <AlertDescription>
        Messages are classified and logged, but nothing is deleted, warned about or blocked. Turn it off in Settings once the activity log looks right.
      </AlertDescription>
      <AlertAction>
        <Button variant="destructive" size="sm" onClick={onOpenSettings}>
          Open settings
        </Button>
      </AlertAction>
    </Alert>
  );
}
