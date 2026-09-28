import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const STEP_PX = 16;
const LARGE_STEP_PX = 64;
const RESIZE_LISTENER_THROTTLE_MS = 100;

export interface ResizeHandleProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-valuenow": number;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-label": string;
  tabIndex: 0;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}

interface UseResizableWidthOptions {
  id: string;
  defaultWidth: number;
  min: number;
  max: number;
  side?: "left" | "right";
  label?: string;
}

interface UseResizableWidthResult {
  width: number;
  handleProps: ResizeHandleProps;
  resetToDefault: () => void;
}

function storageKey(id: string): string {
  return `resizable-width:${id}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readPersistedWidth(id: string): number | null {
  try {
    const raw = sessionStorage.getItem(storageKey(id));
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    console.warn(`Failed to read persisted width for "${id}"`, error);
    return null;
  }
}

function writePersistedWidth(id: string, width: number): void {
  try {
    sessionStorage.setItem(storageKey(id), String(width));
  } catch (error) {
    console.warn(`Failed to persist width for "${id}"`, error);
  }
}

function clampToViewport(width: number, min: number, max: number): number {
  const viewportMax = Math.min(max, window.innerWidth);
  return clamp(width, min, viewportMax);
}

export function useResizableWidth(
  options: UseResizableWidthOptions
): UseResizableWidthResult {
  const { id, defaultWidth, min, max, side = "left", label = "Resize panel" } = options;

  const [width, setWidth] = useState<number>(() => {
    const persisted = readPersistedWidth(id);
    return clampToViewport(persisted ?? defaultWidth, min, max);
  });

  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const dragCleanupRef = useRef<(() => void) | null>(null);

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clampToViewport(next, min, max);
      setWidth(clamped);
      writePersistedWidth(id, clamped);
      return clamped;
    },
    [id, min, max]
  );

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const handleResize = () => {
      if (timeoutId !== undefined) return;
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        const reclamped = clampToViewport(widthRef.current, min, max);
        if (reclamped !== widthRef.current) {
          setWidth(reclamped);
          writePersistedWidth(id, reclamped);
        }
      }, RESIZE_LISTENER_THROTTLE_MS);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [id, min, max]);

  const resetToDefault = useCallback(() => {
    commitWidth(defaultWidth);
  }, [commitWidth, defaultWidth]);

  const stopDrag = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = widthRef.current;

      const handleMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const delta = moveEvent.clientX - startX;
        const signedDelta = side === "left" ? -delta : delta;
        commitWidth(startWidth + signedDelta);
      };

      const handleUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        stopDrag();
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [commitWidth, side, stopDrag]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? LARGE_STEP_PX : STEP_PX;
      const growKey = side === "left" ? "ArrowLeft" : "ArrowRight";
      const shrinkKey = side === "left" ? "ArrowRight" : "ArrowLeft";

      if (event.key === growKey) {
        event.preventDefault();
        commitWidth(widthRef.current + step);
      } else if (event.key === shrinkKey) {
        event.preventDefault();
        commitWidth(widthRef.current - step);
      } else if (event.key === "Home") {
        event.preventDefault();
        commitWidth(min);
      } else if (event.key === "End") {
        event.preventDefault();
        commitWidth(max);
      } else if (event.key === "Enter") {
        event.preventDefault();
        resetToDefault();
      }
    },
    [commitWidth, max, min, resetToDefault, side]
  );

  useEffect(() => {
    return () => {
      stopDrag();
    };
  }, [stopDrag]);

  const handleProps: ResizeHandleProps = {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-valuenow": Math.round(width),
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-label": label,
    tabIndex: 0,
    onPointerDown,
    onKeyDown,
    onDoubleClick: resetToDefault,
  };

  return { width, handleProps, resetToDefault };
}
