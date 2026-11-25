import type { Viewport } from "./contracts";

export function normalizeViewport(area: Pick<DOMRect, "width" | "height">,
  { left, top, right, bottom }: Pick<DOMRect, "left" | "top" | "right" | "bottom">): Viewport {
  return [left / area.width, top / area.height, (right - left) / area.width, (bottom - top) / area.height];
}

export function viewportInFrame(host: HTMLElement, frame: HTMLElement): Viewport {
  const area = host.getBoundingClientRect();
  const bounds = frame.getBoundingClientRect();
  if (!area.width || !area.height || !bounds.width || !bounds.height) return [0, 0, 1, 1];
  const left = Math.max(0, Math.min(area.width - 1, bounds.left - area.left));
  const top = Math.max(0, Math.min(area.height - 1, bounds.top - area.top));
  const right = Math.max(left + 1, Math.min(area.width, bounds.right - area.left));
  const bottom = Math.max(top + 1, Math.min(area.height, bounds.bottom - area.top));
  return normalizeViewport(area, { left, top, right, bottom });
}
