import type { Structure } from "../catalog/types";

export type Viewport = [number, number, number, number];
export type PreparedGeometry = [Float32Array, Uint32Array, string];

export type ViewerStatus = "loading" | "preparing" | "finishing" | "loadError" | "processError" | "renderError" | "contextLost";

export type CameraCommand =
  | { kind: "pan" | "rotate"; x: number; y: number }
  | { kind: "zoom"; factor: number }
  | { kind: "reset" };

export interface ViewerState {
  building: boolean;
  loadedSystems: number;
  status: ViewerStatus;
  error: boolean;
  meshes: Structure[];
  selected: string;
  movingId: string;
  separatedIds: ReadonlySet<string>;
}

export interface StudyViewer {
  select(id: string): boolean;
  changeVisibility(ids: string[], shown: boolean): boolean;
  focus(ids: string[], folder: boolean, reveal: boolean): boolean;
  setExplosion(value: number, ids: string[]): boolean;
  retargetExplosion(value: number, ids: string[]): void;
  overview(): boolean;
  control(commands: CameraCommand[]): boolean;
  setMoving(id: string): boolean;
  restoreStructure(id: string): boolean;
}
