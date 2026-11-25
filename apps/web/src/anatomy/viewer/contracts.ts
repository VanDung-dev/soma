export type Viewport = [number, number, number, number];
export type PreparedGeometry = [Float32Array, Uint32Array, string];
export type ViewerHold = { x: number; y: number; action: "hide" | "move" };

export type CameraPose = {
  target: [number, number, number];
  yaw: number;
  pitch: number;
  distance: number;
  pan: [number, number];
};

export type SceneView = { camera: CameraPose; explosion: number };

export type ViewerStatus = "loading" | "preparing" | "finishing" | "loadError" | "processError" | "renderError" | "contextLost";

export type CameraCommand =
  | { kind: "pan" | "rotate"; x: number; y: number }
  | { kind: "zoom"; factor: number }
  | { kind: "orient"; axis: "X" | "Y" | "Z"; direction: -1 | 1 }
  | { kind: "reset" };

export interface ViewerState {
  building: boolean;
  loadedSystems: number;
  status: ViewerStatus;
  error: boolean;
  structureIds: string[];
  selected: string;
  movingId: string;
  separatedIds: ReadonlySet<string>;
}

export interface StudyViewer {
  captureView(): SceneView | undefined;
  applyScene(ids: string[], view?: SceneView): boolean;
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
