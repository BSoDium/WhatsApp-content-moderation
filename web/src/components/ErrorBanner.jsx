import { Alert, AlertTitle, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function ErrorBanner({ error, onDismiss }) {
  return (
    <Alert variant="destructive" className="mt-4">
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>{error.description}</AlertDescription>
      {error.retry && (
        <AlertAction>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onDismiss();
              error.retry();
            }}
          >
            Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
