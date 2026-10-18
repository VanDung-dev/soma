import type { AnatomyViewer } from "../wasm/anatomy_wasm";

export function bindViewerInput(canvas: HTMLCanvasElement, options: {
  enabled: () => boolean;
  frame: () => DOMRect;
  operate: (action: (viewer: AnatomyViewer) => void, redraw?: boolean) => boolean;
  redraw: () => void;
  hover: (id: string) => void;
  pick: (id: string) => void;
}) {
  const pointers = new Map<number, { x: number; y: number }>();
  let down = { x: 0, y: 0 };
  let dragged = false;
  const withinFocusFrame = (event: MouseEvent) => {
    const bounds = options.frame();
    return event.clientX >= bounds.left && event.clientX < bounds.right
      && event.clientY >= bounds.top && event.clientY < bounds.bottom;
  };
  const pointerDown = (event: PointerEvent) => {
    if (!options.enabled() || !withinFocusFrame(event)) return;
    canvas.focus({ preventScroll: true });
    clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined;
    canvas.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.size) { down = point; dragged = false; }
    else dragged = true;
    pointers.set(event.pointerId, point);
  };
  const pick = (event: PointerEvent, read = false) => {
    if (!options.enabled() || !withinFocusFrame(event)) return;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width);
    const y = canvas.height - 1 - Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height);
    if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) options.operate(renderer => {
      const before = renderer.selected_id();
      const id = renderer.pick(x, y);
      options.hover(id);
      if (read) {
        if (id !== before) options.redraw();
        options.pick(id);
      } else renderer.select(before);
    }, false);
  };
  let hoverTimer = 0;
  let hoverEvent: PointerEvent | undefined;
  const pointerMove = (event: PointerEvent) => {
    if (!withinFocusFrame(event)) {
      pointerCancel(event);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      pointerLeave();
      return;
    }
    const previous = pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === "mouse" && !event.buttons) {
        hoverEvent = event;
        clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(() => {
          hoverTimer = 0;
          if (!pointers.size && hoverEvent) pick(hoverEvent);
        }, 100);
      }
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    const dx = point.x - previous.x, dy = point.y - previous.y;
    if (Math.hypot(point.x - down.x, point.y - down.y) > 5) dragged = true;
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(point.x - other.x, point.y - other.y);
      if (before > 1 && after > 1) options.operate(renderer => renderer.zoom(before / after));
      options.operate(renderer => renderer.pan(-dx / canvas.clientHeight / 2, dy / canvas.clientHeight / 2));
    } else if (event.button === 2 || (event.buttons & 2) || event.shiftKey) {
      options.operate(renderer => renderer.pan(-dx / canvas.clientHeight, dy / canvas.clientHeight));
    } else options.operate(renderer => renderer.rotate(-dx / canvas.clientHeight * Math.PI * 2, dy / canvas.clientHeight * Math.PI * 2));
    pointers.set(event.pointerId, point);
  };
  const pointerUp = (event: PointerEvent) => {
    if (pointers.has(event.pointerId) && pointers.size === 1 && !dragged && event.button !== 2) {
      pick(event, true);
    }
    pointers.delete(event.pointerId);
  };
  const pointerCancel = (event: PointerEvent) => { pointers.delete(event.pointerId); dragged = true; };
  const pointerLeave = () => { clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined; options.hover(""); };
  const wheel = (event: WheelEvent) => {
    if (!withinFocusFrame(event)) return;
    event.preventDefault();
    if (!options.enabled()) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    const bounds = canvas.getBoundingClientRect();
    options.operate(renderer => renderer.zoom_at(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
      Math.exp(Math.max(-1, Math.min(1, pixels * 0.001))),
    ));
  };
  const contextMenu = (event: MouseEvent) => { if (withinFocusFrame(event)) event.preventDefault(); };
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("lostpointercapture", pointerCancel); canvas.addEventListener("pointerleave", pointerLeave);
  canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("contextmenu", contextMenu);
  return () => {
    clearTimeout(hoverTimer);
    canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerCancel);
    canvas.removeEventListener("lostpointercapture", pointerCancel); canvas.removeEventListener("pointerleave", pointerLeave);
    canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("contextmenu", contextMenu);
  };
}
