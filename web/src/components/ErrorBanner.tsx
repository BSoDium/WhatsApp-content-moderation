import { Alert, AlertTitle, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ControlError } from '@/lib/types';

interface ErrorBannerProps {
  error: ControlError;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  const retry = error.retry;

  return (
    <Alert variant="destructive" className="mt-4">
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>{error.description}</AlertDescription>
      {retry && (
        <AlertAction>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDismiss();
              retry();
            }}
          >
            Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
