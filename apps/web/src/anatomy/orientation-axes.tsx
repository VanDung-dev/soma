import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import { useLanguage } from "../i18n";
import type { CameraCommand } from "./viewer/contracts";

export type OrientationAxesHandle = { update: (axes: Float32Array) => void };
type AxisCommand = Extract<CameraCommand, { kind: "orient" }>;

export function OrientationAxes({ ref, disabled, onControl }: {
  ref: Ref<OrientationAxesHandle>; disabled: boolean; onControl: (commands: CameraCommand[]) => boolean;
}) {
  const { t } = useLanguage();
  const [axes, setAxes] = useState<Float32Array>();
  const [selected, setSelected] = useState<AxisCommand>();
  const aligned = useRef(false);
  const element = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean; command?: AxisCommand }>(undefined);
  const cancelDrag = () => {
    const active = drag.current;
    drag.current = undefined;
    if (element.current) {
      delete element.current.dataset.dragging;
      if (active && element.current.hasPointerCapture(active.id)) element.current.releasePointerCapture(active.id);
    }
  };
  useEffect(() => {
    if (disabled) cancelDrag();
    window.addEventListener("blur", cancelDrag);
    return () => { window.removeEventListener("blur", cancelDrag); cancelDrag(); };
  }, [disabled]);
  useImperativeHandle(ref, () => ({ update: setAxes }), []);
  useEffect(() => {
    if (!axes || !selected) return;
    const depth = axes["XYZ".indexOf(selected.axis) * 3 + 2]! * selected.direction;
    if (depth > 0.99999) aligned.current = true;
    else if (aligned.current) { aligned.current = false; setSelected(undefined); }
  }, [axes, selected]);
  const selectView = (command: AxisCommand) => {
    const depth = axes?.["XYZ".indexOf(command.axis) * 3 + 2];
    const target = depth !== undefined && depth * command.direction > 0.99999
      ? { ...command, direction: command.direction === 1 ? -1 as const : 1 as const } : command;
    if (onControl([target])) { aligned.current = false; setSelected(target); }
  };
  const endpoints = axes ? (["X", "Y", "Z"] as const).flatMap((label, index) => ([-1, 1] as const).map(sign => ({
    label, sign, x: axes[index * 3]! * sign * 38, y: -axes[index * 3 + 1]! * sign * 38,
    depth: axes[index * 3 + 2]! * sign,
  }))).sort((a, b) => a.depth - b.depth) : [];
  return <svg ref={element} className="orientation-axes" viewBox="0 0 112 112" role="group" aria-label={t("viewer.orientation.label")}
    aria-disabled={disabled} visibility={axes ? undefined : "hidden"}
    onPointerDown={event => {
      if (disabled || event.button !== 0 || drag.current) return;
      event.preventDefault();
      const endpoint = (event.target as Element).closest<SVGGElement>("[data-axis]");
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false,
        command: endpoint ? { kind: "orient", axis: endpoint.dataset.axis as AxisCommand["axis"], direction: Number(endpoint.dataset.direction) as -1 | 1 } : undefined };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = "true";
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId || disabled) return;
      if (!event.buttons) { cancelDrag(); return; }
      if (!active.moved && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) <= 4) return;
      event.preventDefault();
      active.moved = true;
      aligned.current = false; setSelected(undefined);
      onControl([{ kind: "rotate", x: (active.x - event.clientX) * 0.01, y: (event.clientY - active.y) * 0.01 }]);
      active.x = event.clientX; active.y = event.clientY;
    }}
    onPointerUp={event => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      event.preventDefault(); cancelDrag();
      if (!disabled && !active.moved && active.command) selectView(active.command);
    }}
    onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
    <title>{t("viewer.orientation.hint")}</title>
    <circle className="orientation-origin" cx="56" cy="56" r="2" />
    {endpoints.map(({ label, sign, x, y, depth }) => <g key={`${label}${sign}`} data-axis={label} data-direction={sign}
      opacity={1 - Math.max(0, -depth) * 0.55} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
      aria-pressed={selected?.axis === label && selected.direction === sign && depth > 0.99999}
      aria-label={t("viewer.orientation.axis", { axis: `${sign > 0 ? "+" : "−"}${label}` })}
      onClick={event => { if (!disabled && event.detail === 0) selectView({ kind: "orient", axis: label, direction: sign }); }}
      onKeyDown={event => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault(); selectView({ kind: "orient", axis: label, direction: sign });
        }
      }}>
      {sign > 0 && <line x1="56" y1="56" x2={56 + x} y2={56 + y} />}
      <circle className="orientation-hit-target" cx={56 + x} cy={56 + y} r="17" />
      <circle cx={56 + x} cy={56 + y} r="12" />
      <text x={56 + x} y={56 + y} dy=".35em" textAnchor="middle">{sign < 0 ? "−" : ""}{label}</text>
    </g>)}
  </svg>;
}
