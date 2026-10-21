import type { AnatomyViewer } from "../../wasm/anatomy_wasm";
import { shortcutAction } from "../../shortcuts";

export function bindViewerInput(canvas: HTMLCanvasElement, options: {
  enabled: () => boolean;
  operate: (action: (viewer: AnatomyViewer) => void, redraw?: boolean) => boolean;
  redraw: () => void;
  pick: (id: string) => void;
  moving?: () => string;
  movable?: (id: string) => boolean;
  moved?: (id: string) => void;
  restore?: () => void;
}) {
  const pointers = new Map<number, { x: number; y: number }>();
  let down = { x: 0, y: 0 };
  let dragged = false;
  let rightDragged = false;
  let blockedPointer: number | undefined;
  let drag: { pointerId: number; id: string; offset: Float32Array } | undefined;
  const pointerDown = (event: PointerEvent) => {
    if (!options.enabled() || (event.button === 2 && event.shiftKey)) return;
    canvas.focus({ preventScroll: true });
    if (event.button === 2) rightDragged = false;
    clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined;
    canvas.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.size) { down = point; dragged = false; }
    else dragged = true;
    pointers.set(event.pointerId, point);
    const id = options.moving?.();
    if (event.button === 0 && !event.shiftKey && id && pointers.size === 1) {
      const bounds = canvas.getBoundingClientRect();
      options.operate(viewer => {
        const before = viewer.selected_id();
        const hit = viewer.pick(Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width),
          canvas.height - 1 - Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height));
        viewer.select(before);
        if (hit && (options.movable?.(hit) ?? hit === id)) {
          drag = { pointerId: event.pointerId, id: hit, offset: viewer.structure_offset(hit) };
          canvas.dataset.dragging = "true";
        } else if (hit) blockedPointer = event.pointerId;
      }, false);
    } else if (drag) cancelDrag();
  };
  const pick = (event: PointerEvent, read = false) => {
    if (!options.enabled()) return;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width);
    const y = canvas.height - 1 - Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height);
    if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) options.operate(renderer => {
      const before = renderer.selected_id();
      const id = renderer.pick(x, y);
      canvas.dataset.draggable = id && (options.movable?.(id) ?? id === options.moving?.()) ? "true" : "false";
      if (read) {
        if (id !== before) options.redraw();
        options.pick(id);
      } else renderer.select(before);
    }, false);
  };
  let hoverTimer = 0;
  let hoverEvent: PointerEvent | undefined;
  const pointerMove = (event: PointerEvent) => {
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
    if (dragged && (event.buttons & 2)) rightDragged = true;
    if (drag?.pointerId === event.pointerId) {
      if (options.enabled()) options.operate(viewer => viewer.move_structure(drag!.id, dx / canvas.clientWidth, dy / canvas.clientHeight));
    } else if (!other && blockedPointer === event.pointerId && !(event.buttons & 2) && !event.shiftKey) {
      pointers.set(event.pointerId, point);
      return;
    } else if (other) {
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
    if (drag?.pointerId === event.pointerId) {
      const id = drag.id;
      drag = undefined; canvas.dataset.dragging = "false";
      if (!dragged) pick(event, true);
      options.moved?.(id);
    }
    else if (pointers.has(event.pointerId) && pointers.size === 1 && !dragged && event.button !== 2) {
      pick(event, true);
    }
    pointers.delete(event.pointerId);
    if (blockedPointer === event.pointerId) blockedPointer = undefined;
  };
  const cancelDrag = () => {
    if (drag) {
      const previous = drag; drag = undefined;
      canvas.dataset.dragging = "false";
      options.operate(viewer => viewer.restore_structure(previous.id, previous.offset));
      options.moved?.(previous.id);
    }
  };
  const pointerCancel = (event: PointerEvent) => {
    if (drag?.pointerId === event.pointerId) cancelDrag();
    if (blockedPointer === event.pointerId) blockedPointer = undefined;
    pointers.delete(event.pointerId); dragged = true;
  };
  const pointerLeave = () => { clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined; canvas.dataset.draggable = "false"; };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (drag) return;
    if (!options.enabled()) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    const bounds = canvas.getBoundingClientRect();
    options.operate(renderer => renderer.zoom_at(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
      Math.exp(Math.max(-1, Math.min(1, pixels * 0.001))),
    ));
  };
  const contextMenu = (event: MouseEvent) => {
    if (!event.shiftKey && event.button === 2 && rightDragged) event.preventDefault();
  };
  const keyDown = (event: KeyboardEvent) => {
    const action = shortcutAction(event);
    if (drag && action) {
      const current = drag; drag = undefined; canvas.dataset.dragging = "false"; pointers.clear();
      if (action === "restore") { event.preventDefault(); options.restore?.(); }
      else options.moved?.(current.id);
      return;
    }
    if (drag && ["w", "a", "s", "d", "e", "q", "r", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(event.key.toLowerCase())) {
      event.preventDefault(); return;
    }
  };
  const blur = () => { cancelDrag(); blockedPointer = undefined; pointers.clear(); };
  canvas.addEventListener("keydown", keyDown); window.addEventListener("blur", blur);
  window.addEventListener("resize", blur);
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("lostpointercapture", pointerCancel); canvas.addEventListener("pointerleave", pointerLeave);
  canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("contextmenu", contextMenu);
  return () => {
    clearTimeout(hoverTimer);
    canvas.removeEventListener("keydown", keyDown); window.removeEventListener("blur", blur);
    window.removeEventListener("resize", blur);
    canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerCancel);
    canvas.removeEventListener("lostpointercapture", pointerCancel); canvas.removeEventListener("pointerleave", pointerLeave);
    canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("contextmenu", contextMenu);
  };
}
