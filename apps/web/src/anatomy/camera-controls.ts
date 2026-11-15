import type { MessageKey } from "../i18n";
import type { CameraCommand } from "./viewer/contracts";

export const cameraControlGroups: { label: MessageKey; controls: { key: string; label: MessageKey; action: (step: number) => CameraCommand }[] }[] = [
  { label: "controls.group.camera", controls: [
    { key: "w", label: "controls.direction.up", action: (step: number): CameraCommand => ({ kind: "pan", x: 0, y: 0.06 * step }) },
    { key: "a", label: "controls.direction.left", action: (step: number): CameraCommand => ({ kind: "pan", x: -0.06 * step, y: 0 }) },
    { key: "s", label: "controls.direction.down", action: (step: number): CameraCommand => ({ kind: "pan", x: 0, y: -0.06 * step }) },
    { key: "d", label: "controls.direction.right", action: (step: number): CameraCommand => ({ kind: "pan", x: 0.06 * step, y: 0 }) },
  ] },
  { label: "controls.group.rotate", controls: [
    { key: "arrowup", label: "controls.direction.up", action: (step: number): CameraCommand => ({ kind: "rotate", x: 0, y: Math.PI / 8 * step }) },
    { key: "arrowleft", label: "controls.direction.left", action: (step: number): CameraCommand => ({ kind: "rotate", x: Math.PI / 8 * step, y: 0 }) },
    { key: "arrowdown", label: "controls.direction.down", action: (step: number): CameraCommand => ({ kind: "rotate", x: 0, y: -Math.PI / 8 * step }) },
    { key: "arrowright", label: "controls.direction.right", action: (step: number): CameraCommand => ({ kind: "rotate", x: -Math.PI / 8 * step, y: 0 }) },
  ] },
  { label: "controls.group.zoom", controls: [
    { key: "e", label: "controls.zoom.in", action: (step: number): CameraCommand => ({ kind: "zoom", factor: 1.2 ** -step }) },
    { key: "q", label: "controls.zoom.out", action: (step: number): CameraCommand => ({ kind: "zoom", factor: 1.2 ** step }) },
  ] },
  { label: "controls.group.view", controls: [
    { key: "r", label: "controls.reset", action: (): CameraCommand => ({ kind: "reset" }) },
  ] },
];
export const cameraControls = cameraControlGroups.flatMap(group => group.controls);
