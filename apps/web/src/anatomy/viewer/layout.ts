import type { Viewport } from "./contracts";

export type HandImageBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;
export const desktopPanelQuery = "(min-width: 1141px)";

export function viewportInFrame(host: HTMLElement, frame: HTMLElement): Viewport {
  const area = host.getBoundingClientRect();
  const bounds = frame.getBoundingClientRect();
  if (!area.width || !area.height || !bounds.width || !bounds.height) return [0, 0, 1, 1];
  const left = Math.max(0, Math.min(area.width - 1, bounds.left - area.left));
  const top = Math.max(0, Math.min(area.height - 1, bounds.top - area.top));
  const right = Math.max(left + 1, Math.min(area.width, bounds.right - area.left));
  const bottom = Math.max(top + 1, Math.min(area.height, bounds.bottom - area.top));
  return [left / area.width, top / area.height, (right - left) / area.width, (bottom - top) / area.height];
}

export function measureHandImage(host: HTMLElement, aspect: number): HandImageBounds {
  const bounds = host.getBoundingClientRect();
  const width = Math.min(bounds.width, bounds.height * aspect), height = width / aspect;
  return { left: bounds.left + (bounds.width - width) / 2, top: bounds.top + (bounds.height - height) / 2, width, height };
}

export function measureHandRegion(host: HTMLElement, video: HTMLVideoElement, frame: HTMLElement, obstacles: HTMLElement[]): number[] {
  if (!video.videoWidth || !video.videoHeight) return [0, 0, 0, 0];
  const { left, top, width, height } = measureHandImage(host, video.videoWidth / video.videoHeight);
  if (!width || !height) return [0, 0, 0, 0];
  const rect = (element: HTMLElement) => {
    const area = element.getBoundingClientRect();
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    return [clamp((area.left - left) / width), clamp((area.top - top) / height),
      clamp((area.right - left) / width), clamp((area.bottom - top) / height)];
  };
  const region = rect(frame);
  for (const obstacle of obstacles) {
    const area = rect(obstacle);
    if (area[0]! < area[2]! && area[1]! < area[3]!) region.push(...area);
  }
  return region;
}

export function measureViewport(elements: {
  host: HTMLElement; frame: HTMLElement; menu: HTMLElement; catalog: HTMLElement; information: HTMLElement; hud: HTMLElement;
}): Viewport {
  const { host, frame, menu, catalog, information, hud } = elements;
  const area = host.getBoundingClientRect();
  if (area.width <= 1 || area.height <= 1) return [0, 0, 1, 1];
  const desktop = window.matchMedia(desktopPanelQuery).matches;
  const catalogArea = desktop ? catalog.getBoundingClientRect() : undefined;
  const informationArea = desktop ? information.getBoundingClientRect() : undefined;
  const left = Math.min(area.width - 1, Math.max(0, catalogArea?.width ? catalogArea.right - area.left + 12 : 12));
  const right = Math.min(area.width, Math.max(left + 1, informationArea?.width ? informationArea.left - area.left - 12 : area.width - 12));
  const panelArea = catalogArea?.width ? catalogArea : informationArea?.width ? informationArea : undefined;
  const frameTop = Math.min(area.height - 1, Math.max(0, (panelArea?.top ?? menu.getBoundingClientRect().bottom + 12) - area.top));
  const frameBottom = Math.min(area.height, Math.max(frameTop + 1, panelArea ? panelArea.bottom - area.top : area.height - 16));
  Object.assign(frame.style, { left: `${left}px`, top: `${frameTop}px`, width: `${Math.max(1, right - left)}px`, height: `${Math.max(1, frameBottom - frameTop)}px` });
  // Reserve the controls inside the frame when fitting anatomy to the camera.
  const top = Math.min(area.height - 1, Math.max(110, frameTop));
  const bottom = Math.min(area.height, Math.max(top + 1, hud.getBoundingClientRect().top - area.top - 12));
  return [left / area.width, top / area.height, (right - left) / area.width, (bottom - top) / area.height];
}
