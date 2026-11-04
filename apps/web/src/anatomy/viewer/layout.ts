import type { Viewport } from "./contracts";

export type HandImageBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;
export const desktopPanelQuery = "(min-width: 1141px)";

export function viewportInFrame(host: HTMLElement, frame: HTMLElement): Viewport {
  const area = host.getBoundingClientRect();
  const bounds = frame.getBoundingClientRect();
  if (!area.width || !area.height || !bounds.width || !bounds.height) return [0, 0, 1, 1];
  return [(bounds.left - area.left) / area.width, (bounds.top - area.top) / area.height,
    bounds.width / area.width, bounds.height / area.height];
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
  const desktop = window.matchMedia(desktopPanelQuery).matches;
  const catalogArea = desktop ? catalog.getBoundingClientRect() : undefined;
  const informationArea = desktop ? information.getBoundingClientRect() : undefined;
  const left = catalogArea?.width ? Math.max(12, catalogArea.right - area.left + 12) : 12;
  const right = informationArea?.width ? Math.min(area.width - 12, informationArea.left - area.left - 12) : area.width - 12;
  const panelArea = catalogArea?.width ? catalogArea : informationArea?.width ? informationArea : undefined;
  const frameTop = (panelArea?.top ?? menu.getBoundingClientRect().bottom + 12) - area.top;
  const frameBottom = panelArea ? panelArea.bottom - area.top : area.height - 16;
  Object.assign(frame.style, { left: `${left}px`, top: `${frameTop}px`, width: `${Math.max(1, right - left)}px`, height: `${Math.max(1, frameBottom - frameTop)}px` });
  // Reserve the controls inside the frame when fitting anatomy to the camera.
  const top = Math.max(110, frameTop), bottom = Math.max(top + 1, hud.getBoundingClientRect().top - area.top - 12);
  return [left / area.width, top / area.height, Math.max(1, right - left) / area.width, Math.max(1, bottom - top) / area.height];
}
