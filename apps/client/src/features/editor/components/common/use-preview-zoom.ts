import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, PointerEvent } from "react";

type Point = { x: number; y: number };
type Transform = Point & { scale: number };
type ViewportSize = { width: number; height: number };

export const MIN_PREVIEW_SCALE = 1;
export const MAX_PREVIEW_SCALE = 8;
const INITIAL_TRANSFORM: Transform = { scale: 1, x: 0, y: 0 };

export function constrainPreviewTransform(
  transform: Transform,
  size: ViewportSize,
): Transform {
  const scale = Math.min(
    MAX_PREVIEW_SCALE,
    Math.max(MIN_PREVIEW_SCALE, transform.scale),
  );
  const maxX = (size.width * (scale - 1)) / 2;
  const maxY = (size.height * (scale - 1)) / 2;
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, transform.x)),
    y: Math.min(maxY, Math.max(-maxY, transform.y)),
  };
}

export function zoomPreviewAt(
  transform: Transform,
  scale: number,
  anchor: Point,
  size: ViewportSize,
): Transform {
  const nextScale = Math.min(
    MAX_PREVIEW_SCALE,
    Math.max(MIN_PREVIEW_SCALE, scale),
  );
  const ratio = nextScale / transform.scale;
  return constrainPreviewTransform(
    {
      scale: nextScale,
      x: anchor.x - (anchor.x - transform.x) * ratio,
      y: anchor.y - (anchor.y - transform.y) * ratio,
    },
    size,
  );
}

function gesture(points: Point[]) {
  const [first, second] = points;
  return {
    center: second
      ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      : first,
    distance: second ? Math.hypot(second.x - first.x, second.y - first.y) : 0,
  };
}

export function usePreviewZoom() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef(INITIAL_TRANSFORM);
  const pointers = useRef(new Map<number, Point>());
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);
  const [dragging, setDragging] = useState(false);

  const update = useCallback((next: Transform) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    transformRef.current = constrainPreviewTransform(next, rect);
    setTransform(transformRef.current);
  }, []);

  const zoomTo = useCallback(
    (scale: number, anchor: Point = { x: 0, y: 0 }) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      update(zoomPreviewAt(transformRef.current, scale, anchor, rect));
    },
    [update],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      // Trackpad pinch is delivered as a Ctrl+wheel event by browsers.
      if (!event.altKey && !event.ctrlKey) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoomTo(
        transformRef.current.scale *
          Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01),
        {
          x: event.clientX - rect.left - rect.width / 2,
          y: event.clientY - rect.top - rect.height / 2,
        },
      );
    };
    const onResize = () => update(transformRef.current);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onResize);
    if (observer) observer.observe(viewport);
    else window.addEventListener("resize", onResize);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      viewport.removeEventListener("wheel", onWheel);
    };
  }, [update, zoomTo]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const previous = gesture([...pointers.current.values()]);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const next = gesture([...pointers.current.values()]);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = transformRef.current;
    const zoomed =
      previous.distance > 0 && next.distance > 0
        ? zoomPreviewAt(
            current,
            (current.scale * next.distance) / previous.distance,
            {
              x: previous.center.x - rect.left - rect.width / 2,
              y: previous.center.y - rect.top - rect.height / 2,
            },
            rect,
          )
        : current;
    update({
      ...zoomed,
      x: zoomed.x + next.center.x - previous.center.x,
      y: zoomed.y + next.center.y - previous.center.y,
    });
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    setDragging(pointers.current.size > 0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const current = transformRef.current;
    switch (event.key) {
      case "+":
      case "=":
        zoomTo(current.scale * 1.25);
        break;
      case "-":
        zoomTo(current.scale / 1.25);
        break;
      case "0":
        update(INITIAL_TRANSFORM);
        break;
      case "ArrowLeft":
        update({ ...current, x: current.x + 40 });
        break;
      case "ArrowRight":
        update({ ...current, x: current.x - 40 });
        break;
      case "ArrowUp":
        update({ ...current, y: current.y + 40 });
        break;
      case "ArrowDown":
        update({ ...current, y: current.y - 40 });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return {
    viewportRef,
    transform,
    dragging,
    zoomIn: () => zoomTo(transformRef.current.scale * 1.25),
    zoomOut: () => zoomTo(transformRef.current.scale / 1.25),
    reset: () => update(INITIAL_TRANSFORM),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
      onKeyDown,
      onDragStart: (event: DragEvent) => event.preventDefault(),
    },
  };
}
