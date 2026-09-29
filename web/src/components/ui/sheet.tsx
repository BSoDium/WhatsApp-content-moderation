"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { ResizeHandle } from "@/components/ResizeHandle"
import { useResizableWidth } from "@/lib/useResizableWidth"
import { useMediaQuery } from "@/lib/useMediaQuery"
import { XIcon } from "lucide-react"

// Below this width a wide sheet stays a full-width overlay, since there's no slack to resize into.
const RESIZABLE_QUERY = "(min-width: 640px)"

export interface SheetResizableConfig {
  id: string
  defaultWidth: number
  min: number
  max: number
  label?: string
}

// The handle is the sheet's first tabbable child, so Radix's default autofocus would land on it and paint its focus ring on every open.
function focusContentInstead(event: Event) {
  event.preventDefault()
  ;(event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
}

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  skipInitialAnimation = false,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay> & { skipInitialAnimation?: boolean }) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      style={skipInitialAnimation ? { animation: "none" } : undefined}
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  size = "default",
  showCloseButton = true,
  resizable,
  skipInitialAnimation = false,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  size?: "default" | "wide"
  showCloseButton?: boolean
  resizable?: SheetResizableConfig
  skipInitialAnimation?: boolean
}) {
  const canResize = useMediaQuery(RESIZABLE_QUERY) && (side === "left" || side === "right")
  const handleEdge = side === "right" ? "left" : "right"
  const { width, handleProps } = useResizableWidth({
    id: resizable?.id ?? `sheet-${side}`,
    defaultWidth: resizable?.defaultWidth ?? 640,
    min: resizable?.min ?? 420,
    max: resizable?.max ?? 1100,
    side: handleEdge,
    label: resizable?.label ?? "Resize panel",
  })
  const isResizable = size === "wide" && resizable !== undefined
  const resizeActive = isResizable && canResize

  return (
    <SheetPortal>
      <SheetOverlay skipInitialAnimation={skipInitialAnimation} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        style={{
          ...(resizeActive ? { width, maxWidth: "none" } : {}),
          ...(skipInitialAnimation ? { animation: "none" } : {}),
        }}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10",
          // The resize handle draws its own divider, so a resizable panel's border would read as a double line.
          !resizeActive && "data-[side=left]:border-r data-[side=right]:border-l",
          // Scoped with the same data-[side=] variant as the defaults above so cn()'s tailwind-merge dedup drops the conflicting default, instead of the two competing on CSS specificity.
          size === "wide" &&
            "data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-2xl data-[side=right]:sm:max-w-2xl data-[side=left]:md:max-w-3xl data-[side=right]:md:max-w-3xl",
          className
        )}
        onOpenAutoFocus={resizeActive ? focusContentInstead : undefined}
        {...props}
      >
        {resizeActive && (
          <ResizeHandle {...handleProps} edge={handleEdge} className={cn("absolute inset-y-0", handleEdge === "left" ? "left-0" : "right-0")} />
        )}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
