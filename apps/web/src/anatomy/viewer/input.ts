import type { AnatomyViewer } from "../../wasm/wasm";
import { shortcutAction } from "../../shortcuts";
import { isCameraKey } from "../camera-controls";

export function bindViewerInput(canvas: HTMLCanvasElement, options: {
  enabled: () => boolean;
  operate: (action: (viewer: AnatomyViewer) => void, redraw?: boolean) => boolean;
  redraw: () => void;
  pick: (id: string) => void;
  selectable?: () => boolean;
  moving?: () => string;
  movable?: (id: string) => boolean;
  joined?: (id: string) => boolean;
  detachable?: () => boolean;
  detach?: (id: string) => boolean;
  beginGroup?: (id: string) => boolean;
  hide?: (ids: string[]) => boolean;
  onBox?: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  onHold?: (point: { x: number; y: number; action: "hide" | "move" } | null) => void;
  snap?: (id: string, commit: boolean) => void;
  moved?: (id: string) => void;
  restore?: () => void;
}) {
  const pointers = new Map<number, { x: number; y: number }>();
  let down = { x: 0, y: 0 };
  let dragged = false;
  let blockedPointer: { id: number; buttons: number } | undefined;
  let drag: { pointerId: number; id: string; offsets: Map<string, Float32Array>; group: boolean } | undefined;
  let box: { pointerId: number; start: { x: number; y: number }; end: { x: number; y: number } } | undefined;
  const boxRect = () => {
    const bounds = canvas.getBoundingClientRect();
    const x1 = Math.max(0, Math.min(bounds.width, box!.start.x - bounds.left));
    const y1 = Math.max(0, Math.min(bounds.height, box!.start.y - bounds.top));
    const x2 = Math.max(0, Math.min(bounds.width, box!.end.x - bounds.left));
    const y2 = Math.max(0, Math.min(bounds.height, box!.end.y - bounds.top));
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  };
  const cancelBox = () => { box = undefined; options.onBox?.(null); };
  let hold: { pointerId: number; timer: number; button: number; action: "hide" | "move" } | undefined;
  const cancelHold = () => {
    if (!hold) return;
    window.clearTimeout(hold.timer); hold = undefined;
    options.onHold?.(null);
  };
  const pickPosition = (event: PointerEvent): [number, number] => {
    const bounds = canvas.getBoundingClientRect();
    return [Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width),
      canvas.height - 1 - Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height)];
  };
  const pointerDown = (event: PointerEvent) => {
    cancelHold();
    if (!options.enabled()) return;
    canvas.focus({ preventScroll: true });
    clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined;
    canvas.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.size) { down = point; dragged = false; }
    else dragged = true;
    pointers.set(event.pointerId, point);
    if (box) cancelBox();
    if (event.button === 0 && event.shiftKey && pointers.size === 1 && options.selectable?.() !== false) {
      event.preventDefault(); cancelDrag();
      box = { pointerId: event.pointerId, start: point, end: point };
      options.onBox?.(boxRect());
      return;
    }
    const id = options.moving?.();
    if ((event.button === 0 || event.button === 2) && !event.shiftKey && pointers.size === 1 && options.selectable?.() !== false) {
      const position = pickPosition(event);
      options.operate(viewer => {
        const before = viewer.selected_id();
        const hit = viewer.pick(...position);
        viewer.select(before);
        const members = viewer.selection_ids?.() ?? [];
        const group = members.includes(hit);
        const movable = !!hit && (options.movable?.(hit) ?? hit === id);
        if (event.button === 0 && movable && !group) {
          drag = { pointerId: event.pointerId, id: hit, offsets: new Map([[hit, viewer.structure_offset(hit)]]), group: false };
          canvas.dataset.dragging = "true";
        }
        const hide = event.button === 2;
        if (hit && (hide || group || !movable || options.joined?.(hit))) {
          if (!hide && id && !movable) blockedPointer = { id: event.pointerId, buttons: event.buttons };
          if (event.pointerType === "mouse" && (hide ? options.hide : options.detachable?.() && (group ? options.beginGroup : options.detach))) {
            const action = hide ? "hide" : "move";
            hold = { pointerId: event.pointerId, button: event.buttons, action, timer: window.setTimeout(() => {
              cancelHold();
              if (!options.enabled()) return;
              if (hide) {
                if (options.hide?.(group ? members : [hit])) { dragged = true; blockedPointer = { id: event.pointerId, buttons: event.buttons }; }
                return;
              }
              if (!options.detachable?.() || !(group ? options.beginGroup?.(hit) : options.detach?.(hit))) return;
              options.pick(hit);
              options.operate(current => {
                drag = { pointerId: event.pointerId, id: hit, group,
                  offsets: new Map((group ? members : [hit]).map(member => [member, current.structure_offset(member)])) };
                canvas.dataset.dragging = "true";
                canvas.dataset.draggable = "true";
              }, false);
              dragged = true; blockedPointer = undefined;
            }, 1000) };
            options.onHold?.({ ...point, action });
          }
        }
      }, false);
    } else if (drag) cancelDrag();
  };
  const pick = (event: PointerEvent, read = false) => {
    if (!options.enabled() || options.selectable?.() === false) return;
    const [x, y] = pickPosition(event);
    if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) options.operate(renderer => {
      const before = renderer.selected_id();
      const id = renderer.pick(x, y);
      const members = renderer.selection_ids?.() ?? [];
      canvas.dataset.draggable = id && ((options.movable?.(id) ?? id === options.moving?.()) || members.includes(id)) ? "true" : "false";
      if (read) {
        const clearGroup = members.length > 0 && !members.includes(id);
        if (clearGroup) renderer.clear_selection();
        if (id !== before || clearGroup) options.redraw();
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
    if (box?.pointerId === event.pointerId) {
      if (!options.enabled() || !(event.buttons & 1)) cancelBox();
      else { box.end = point; options.onBox?.(boxRect()); }
      pointers.set(event.pointerId, point);
      dragged = true;
      return;
    }
    const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
    const dx = point.x - previous.x, dy = point.y - previous.y;
    if (Math.hypot(point.x - down.x, point.y - down.y) > 5) dragged = true;
    if (hold?.pointerId === event.pointerId) {
      if (dragged || event.buttons !== hold.button || event.shiftKey || !options.enabled() || (hold.action === "move" && !options.detachable?.())) cancelHold();
      else { options.onHold?.({ ...point, action: hold.action }); pointers.set(event.pointerId, point); return; }
    }
    if (drag?.pointerId === event.pointerId) {
      if (options.enabled() && options.operate(viewer => {
        const id = drag!.id;
        if (viewer.selected_id() !== id) { viewer.select(id); options.pick(id); }
        if (drag!.group) viewer.move_selection(id, dx / canvas.clientWidth, dy / canvas.clientHeight);
        else viewer.move_structure(id, dx / canvas.clientWidth, dy / canvas.clientHeight);
      })) {
        if (!drag.group) options.snap?.(drag.id, false);
      }
    } else if (!other && blockedPointer?.id === event.pointerId && event.buttons === blockedPointer.buttons && !event.shiftKey) {
      pointers.set(event.pointerId, point);
      return;
    } else if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(point.x - other.x, point.y - other.y);
      if (before > 1 && after > 1) options.operate(renderer => renderer.zoom(before / after));
      options.operate(renderer => renderer.pan(-dx / canvas.clientHeight / 2, dy / canvas.clientHeight / 2));
    } else if (event.button === 2 || (event.buttons & 2)) {
      options.operate(renderer => renderer.pan(-dx / canvas.clientHeight, dy / canvas.clientHeight));
    } else options.operate(renderer => renderer.rotate(-dx / canvas.clientHeight * Math.PI * 2, dy / canvas.clientHeight * Math.PI * 2));
    pointers.set(event.pointerId, point);
  };
  const pointerUp = (event: PointerEvent) => {
    cancelHold();
    if (box?.pointerId === event.pointerId) {
      box.end = { x: event.clientX, y: event.clientY };
      const rect = boxRect(), bounds = canvas.getBoundingClientRect();
      cancelBox();
      if (options.enabled()) options.operate(viewer => {
        if (rect.width < 5 || rect.height < 5) return;
        const x = Math.floor(rect.x / bounds.width * canvas.width);
        const top = Math.floor(rect.y / bounds.height * canvas.height);
        const right = Math.min(canvas.width, Math.ceil((rect.x + rect.width) / bounds.width * canvas.width));
        const bottom = Math.min(canvas.height, Math.ceil((rect.y + rect.height) / bounds.height * canvas.height));
        viewer.select_region(x, canvas.height - bottom, right - x, bottom - top);
      });
      pointers.delete(event.pointerId); dragged = true;
      return;
    }
    if (drag?.pointerId === event.pointerId) {
      const { id, group } = drag;
      drag = undefined; canvas.dataset.dragging = "false";
      if (!dragged) pick(event, true);
      if (dragged && !group) options.snap?.(id, true);
      else options.snap?.("", false);
      options.moved?.(id);
    }
    else if (pointers.has(event.pointerId) && pointers.size === 1 && !dragged && event.button !== 2) {
      pick(event, true);
    }
    pointers.delete(event.pointerId);
    if (blockedPointer?.id === event.pointerId) blockedPointer = undefined;
  };
  const cancelDrag = () => {
    if (drag) {
      const previous = drag; drag = undefined;
      canvas.dataset.dragging = "false";
      options.operate(viewer => {
        for (const [id, offset] of previous.offsets) viewer.restore_structure(id, offset);
      });
      options.snap?.("", false);
      options.moved?.(previous.id);
    }
  };
  const pointerCancel = (event: PointerEvent) => {
    cancelHold();
    if (box?.pointerId === event.pointerId) cancelBox();
    if (drag?.pointerId === event.pointerId) cancelDrag();
    if (blockedPointer?.id === event.pointerId) blockedPointer = undefined;
    pointers.delete(event.pointerId); dragged = true;
  };
  const pointerLeave = () => { cancelHold(); clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined; canvas.dataset.draggable = "false"; };
  const wheel = (event: WheelEvent) => {
    cancelHold();
    event.preventDefault();
    if (drag || box) return;
    if (!options.enabled()) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    const bounds = canvas.getBoundingClientRect();
    options.operate(renderer => renderer.zoom_at(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
      Math.exp(Math.max(-1, Math.min(1, pixels * (event.ctrlKey ? 0.01 : 0.001)))),
    ));
  };
  const contextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  const keyDown = (event: KeyboardEvent) => {
    cancelHold();
    let selectedGroup = false;
    if (event.key === "Escape") options.operate(viewer => { selectedGroup = (viewer.selection_ids?.().length ?? 0) > 0; }, false);
    if (event.key === "Escape" && (drag || box || selectedGroup)) {
      event.preventDefault(); cancelDrag(); cancelBox(); pointers.clear(); blockedPointer = undefined;
      options.operate(viewer => viewer.clear_selection?.());
      return;
    }
    const action = shortcutAction(event);
    if (drag && action) {
      const current = drag; drag = undefined; canvas.dataset.dragging = "false"; pointers.clear();
      options.snap?.("", false);
      if (action === "restore") { event.preventDefault(); options.restore?.(); }
      else options.moved?.(current.id);
      return;
    }
    if (drag && isCameraKey(event.key)) {
      event.preventDefault(); return;
    }
  };
  const blur = () => { cancelHold(); cancelDrag(); cancelBox(); blockedPointer = undefined; pointers.clear(); };
  canvas.addEventListener("keydown", keyDown); window.addEventListener("blur", blur);
  window.addEventListener("resize", blur);
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("lostpointercapture", pointerCancel); canvas.addEventListener("pointerleave", pointerLeave);
  canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("contextmenu", contextMenu);
  return () => {
    cancelHold(); cancelDrag(); cancelBox();
    options.snap?.("", false);
    clearTimeout(hoverTimer);
    canvas.removeEventListener("keydown", keyDown); window.removeEventListener("blur", blur);
    window.removeEventListener("resize", blur);
    canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerCancel);
    canvas.removeEventListener("lostpointercapture", pointerCancel); canvas.removeEventListener("pointerleave", pointerLeave);
    canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("contextmenu", contextMenu);
  };
}
