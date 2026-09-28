import { cn } from "@/lib/utils";
import type { ResizeHandleProps as ResizeHandleHookProps } from "@/lib/useResizableWidth";

interface ResizeHandleProps extends ResizeHandleHookProps {
  className?: string;
  // Which edge of this handle's own hit-target coincides with the panel's
  // true visual edge (its shadow/overlay boundary) — the divider line hugs
  // that edge instead of sitting centered in the hit-target, so it reads as
  // the panel's one border instead of a second line a few pixels in from it.
  edge: "left" | "right";
}

export function ResizeHandle({ className, edge, ...handleProps }: ResizeHandleProps) {
  const edgeClass = edge === "left" ? "left-0" : "right-0";
  return (
    <div
      className={cn(
        "group/resize-handle relative z-10 w-3 cursor-col-resize touch-none outline-none",
        className
      )}
      {...handleProps}
    >
      <div
        className={cn(
          "absolute inset-y-0 w-px bg-border transition-[width,background-color]",
          edgeClass,
          "group-hover/resize-handle:w-1 group-hover/resize-handle:bg-ring/50",
          "group-active/resize-handle:w-1 group-active/resize-handle:bg-ring",
          "group-focus-visible/resize-handle:w-1 group-focus-visible/resize-handle:bg-ring"
        )}
      />
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 rounded-full opacity-0 ring-3 ring-ring/50 group-focus-visible/resize-handle:opacity-100" />
    </div>
  );
}
