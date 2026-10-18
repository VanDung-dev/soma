import type { Structure } from "../catalog/types";

export type Viewport = [number, number, number, number];
export type PreparedGeometry = [Float32Array, Uint32Array, string];

export type CameraCommand =
  | { kind: "pan" | "rotate"; x: number; y: number }
  | { kind: "zoom"; factor: number }
  | { kind: "reset" };

export interface ViewerState {
  building: boolean;
  loadedSystems: number;
  status: string;
  error: boolean;
  meshes: Structure[];
  selected: string;
  hovered: string;
}

export interface StudyViewer {
  select(id: string): boolean;
  changeVisibility(ids: string[], shown: boolean): boolean;
  focus(ids: string[], folder: boolean, reveal: boolean): boolean;
  setExplosion(value: number, ids: string[]): boolean;
  retargetExplosion(value: number, ids: string[]): void;
  overview(): boolean;
  control(commands: CameraCommand[]): boolean;
}
