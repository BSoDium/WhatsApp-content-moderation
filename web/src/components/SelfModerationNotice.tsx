import { ShieldQuestionMark } from 'lucide-react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export function SelfModerationNotice() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <ShieldQuestionMark
            className="size-28 text-[color-mix(in_oklab,var(--muted-foreground)_60%,var(--background))]"
            strokeWidth={0.75}
            aria-hidden="true"
          />
        </EmptyMedia>
        <EmptyTitle className="text-lg font-semibold">You don't want to moderate yourself, do you?</EmptyTitle>
        <EmptyDescription>I'm just software. If you want to moderate yourself, you'll need therapy, not a WhatsApp bot.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <EmptyDescription>
          Testing the pipeline on your own messages? Set <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">TEST_ALLOW_SELF=1</code>.
        </EmptyDescription>
      </EmptyContent>
    </Empty>
  );
}
