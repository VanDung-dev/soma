import type { Viewport } from "../viewer/contracts";
import { normalizeViewport } from "../viewer/layout";

export const desktopPanelQuery = "(min-width: 1141px)";

export function measureViewport(elements: {
  host: HTMLElement; frame: HTMLElement; menu: HTMLElement; catalog: HTMLElement; information: HTMLElement; hud: HTMLElement;
}): Viewport {
  const { host, frame, menu, catalog, information, hud } = elements;
  const area = host.getBoundingClientRect();
  if (area.width <= 1 || area.height <= 1) return [0, 0, 1, 1];
  const desktop = window.matchMedia(desktopPanelQuery).matches;
  const catalogArea = desktop ? catalog.getBoundingClientRect() : undefined;
  const informationArea = desktop ? information.getBoundingClientRect() : undefined;
  const left = Math.min(area.width - 1, Math.max(12, catalogArea?.width ? catalogArea.right - area.left + 12 : 12));
  const rightEdge = informationArea?.width ? informationArea.left - area.left - 12 : area.width - 12;
  const right = Math.max(left + 1, Math.min(area.width - 12, rightEdge));
  const panelArea = catalogArea?.width ? catalogArea : informationArea?.width ? informationArea : undefined;
  const frameTop = Math.min(area.height - 1, Math.max(0, (panelArea?.top ?? menu.getBoundingClientRect().bottom + 12) - area.top));
  const frameBottom = Math.min(area.height, Math.max(frameTop + 1, panelArea ? panelArea.bottom - area.top : area.height - 16));
  Object.assign(frame.style, { left: `${left}px`, top: `${frameTop}px`, width: `${Math.max(1, right - left)}px`, height: `${Math.max(1, frameBottom - frameTop)}px` });
  // Reserve the controls inside the frame when fitting anatomy to the camera.
  const top = Math.min(area.height - 1, Math.max(110, frameTop));
  const bottom = Math.min(area.height, Math.max(top + 1, hud.getBoundingClientRect().top - area.top - 12));
  return normalizeViewport(area, { left, top, right, bottom });
}
