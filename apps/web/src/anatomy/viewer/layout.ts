import type { Viewport } from "./contracts";

export function measureHandRegion(host: HTMLElement, video: HTMLVideoElement, frame: HTMLElement, obstacles: HTMLElement[]): number[] {
  const bounds = host.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !video.videoWidth || !video.videoHeight) return [0, 0, 0, 0];
  const scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
  const width = video.videoWidth * scale, height = video.videoHeight * scale;
  const left = bounds.left + (bounds.width - width) / 2, top = bounds.top + (bounds.height - height) / 2;
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
  host: HTMLElement; frame: HTMLElement; catalog: HTMLElement; information: HTMLElement; controls: HTMLElement; hud: HTMLElement;
}): Viewport {
  const { host, frame, catalog, information, controls, hud } = elements;
  const area = host.getBoundingClientRect();
  const desktop = window.matchMedia("(min-width: 1141px)").matches;
  const catalogArea = desktop ? catalog.getBoundingClientRect() : undefined;
  const left = catalogArea ? catalogArea.right - area.left + 12 : 12;
  const right = desktop ? information.getBoundingClientRect().left - area.left - 12 : area.width - 12;
  const frameTop = catalogArea ? catalogArea.top - area.top : controls.getBoundingClientRect().bottom - area.top + 16;
  const frameBottom = catalogArea ? catalogArea.bottom - area.top : area.height - 16;
  Object.assign(frame.style, { left: `${left}px`, top: `${frameTop}px`, width: `${Math.max(1, right - left)}px`, height: `${Math.max(1, frameBottom - frameTop)}px` });
  // Reserve the controls inside the frame when fitting anatomy to the camera.
  const top = Math.max(110, frameTop), bottom = Math.max(top + 1, hud.getBoundingClientRect().top - area.top - 12);
  return [left / area.width, top / area.height, Math.max(1, right - left) / area.width, Math.max(1, bottom - top) / area.height];
}
