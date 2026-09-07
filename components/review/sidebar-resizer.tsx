import { useRef, type PointerEvent as ReactPointerEvent } from "react";

const SIDEBAR_KEYBOARD_STEP_PX = 20;

export type ResizeBounds = { min: number; max: number };
export type GrowDirection = 1 | -1;

type ResizeDrag = { pointerId: number; startX: number; startWidth: number };

export function clampSidebarWidth(width: number, { min, max }: ResizeBounds) {
  return Math.max(min, Math.min(max, width));
}

export function resizeSidebarWidth(
  startWidth: number,
  pointerDelta: number,
  growDirection: GrowDirection,
  bounds: ResizeBounds,
) {
  return clampSidebarWidth(startWidth + pointerDelta * growDirection, bounds);
}

export function SidebarResizer({
  controls,
  label,
  value,
  bounds,
  growDirection,
  onChange,
}: {
  controls: string;
  label: string;
  value: number;
  bounds: ResizeBounds;
  growDirection: GrowDirection;
  onChange: (width: number) => void;
}) {
  const drag = useRef<ResizeDrag | null>(null);
  const resizeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const pointerDelta = event.clientX - current.startX;
    onChange(resizeSidebarWidth(current.startWidth, pointerDelta, growDirection, bounds));
  };

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      onKeyDown={(event) => {
        const horizontalDirection =
          event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!horizontalDirection) return;
        event.preventDefault();
        onChange(
          resizeSidebarWidth(
            value,
            horizontalDirection * SIDEBAR_KEYBOARD_STEP_PX,
            growDirection,
            bounds,
          ),
        );
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: value,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={resizeFromPointer}
      onPointerUp={(event) => {
        resizeFromPointer(event);
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
