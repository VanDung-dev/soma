export type HandImageBounds = Pick<DOMRect, "left" | "top" | "width" | "height">;

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
