import { cn } from "@/lib/utils";
import type { ResizeHandleProps as ResizeHandleHookProps } from "@/lib/useResizableWidth";

interface ResizeHandleProps extends ResizeHandleHookProps {
  className?: string;
}

export function ResizeHandle({ className, ...handleProps }: ResizeHandleProps) {
  return (
    <div
      className={cn(
        "group/resize-handle relative z-10 flex w-3 cursor-col-resize touch-none items-center justify-center outline-none",
        className
      )}
      {...handleProps}
    >
      <div
        className={cn(
          "h-full w-px bg-border transition-colors",
          "group-hover/resize-handle:w-1 group-hover/resize-handle:bg-ring/50",
          "group-active/resize-handle:w-1 group-active/resize-handle:bg-ring",
          "group-focus-visible/resize-handle:w-1 group-focus-visible/resize-handle:bg-ring"
        )}
      />
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 rounded-full opacity-0 ring-3 ring-ring/50 group-focus-visible/resize-handle:opacity-100" />
    </div>
  );
}
