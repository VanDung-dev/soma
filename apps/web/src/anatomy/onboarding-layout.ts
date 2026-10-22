type Area = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

export function placeOnboarding(area: Area, target: Area | null, card: Pick<DOMRect, "width" | "height">, inset: number, preferred?: "below") {
  const gap = 12;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const left = area.left + inset, top = area.top + inset;
  const right = area.right - inset - card.width, bottom = area.bottom - inset - card.height;
  if (!target) return { left: clamp((area.left + area.right - card.width) / 2, left, right),
    top: clamp((area.top + area.bottom - card.height) / 2, top, bottom), placement: "center" };
  const y = clamp(target.top, top, bottom), x = clamp(target.left, left, right);
  if (preferred === "below" && target.bottom + gap <= bottom) return { left: x, top: target.bottom + gap, placement: "below" };
  if (target.right + gap <= right) return { left: target.right + gap, top: y, placement: "right" };
  if (target.left - gap - card.width >= left) return { left: target.left - gap - card.width, top: y, placement: "left" };
  if (target.bottom + gap <= bottom) return { left: x, top: target.bottom + gap, placement: "below" };
  if (target.top - gap - card.height >= top) return { left: x, top: target.top - gap - card.height, placement: "above" };
  return { left: x, top: bottom, placement: "bottom" };
}

export function spotlightPath(width: number, height: number, hole: Area & { radius: number }) {
  const { left: x, top: y, right, bottom } = hole;
  const r = Math.max(0, Math.min(hole.radius, (right - x) / 2, (bottom - y) / 2));
  return `M0 0H${width}V${height}H0Z M${x + r} ${y}H${right - r}Q${right} ${y} ${right} ${y + r}V${bottom - r}Q${right} ${bottom} ${right - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}
