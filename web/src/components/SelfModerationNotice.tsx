import { Sofa } from 'lucide-react';

export function SelfModerationNotice() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <Sofa className="size-28 text-muted-foreground/60" strokeWidth={0.75} aria-hidden="true" />
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">You don't want to moderate yourself, do you?</h2>
        <p className="mx-auto max-w-xs text-sm text-muted-foreground">I'm just software. If you want to moderate yourself, you'll need therapy, not a WhatsApp bot.</p>
      </div>
      <p className="max-w-xs text-xs text-muted-foreground/80">Testing the pipeline on your own messages? Set TEST_ALLOW_SELF=1.</p>
    </div>
  );
}
