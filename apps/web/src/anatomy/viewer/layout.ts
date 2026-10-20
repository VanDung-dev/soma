import type { Viewport } from "./contracts";

export function measureViewport(elements: {
  host: HTMLElement; frame: HTMLElement; catalog: HTMLElement; information: HTMLElement; controls: HTMLElement; hud: HTMLElement;
}): Viewport {
  const { host, frame, catalog, information, controls, hud } = elements;
  const area = host.getBoundingClientRect();
  const desktop = window.matchMedia("(min-width: 1141px)").matches;
  const left = desktop ? catalog.getBoundingClientRect().right - area.left + 12 : 12;
  const right = desktop ? information.getBoundingClientRect().left - area.left - 12 : area.width - 12;
  const frameTop = desktop ? catalog.getBoundingClientRect().top - area.top : controls.getBoundingClientRect().bottom - area.top + 16;
  const frameBottom = desktop ? catalog.getBoundingClientRect().bottom - area.top : area.height - 16;
  Object.assign(frame.style, { left: `${left}px`, top: `${frameTop}px`, width: `${Math.max(1, right - left)}px`, height: `${Math.max(1, frameBottom - frameTop)}px` });
  // Reserve the controls inside the frame when fitting anatomy to the camera.
  const top = Math.max(110, frameTop), bottom = Math.max(top + 1, hud.getBoundingClientRect().top - area.top - 12);
  return [left / area.width, top / area.height, Math.max(1, right - left) / area.width, Math.max(1, bottom - top) / area.height];
}
