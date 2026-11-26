import type { Catalog, ModelLoadPlan } from "../catalog/types";
import { getWasm } from "../core";
import type { AnatomyViewer } from "../wasm/wasm";
import type { CameraCommand, SceneView, StudyViewer, ViewerHold, ViewerState, ViewerStatus, Viewport, VisibilityUpdate } from "./contracts";
import { bindViewerInput, type DragEnd } from "./input";
import { loadModels } from "./loader";
import { defaultGraphics, qualityLevels, renderScales } from "./graphics";
import type { GraphicsSettings } from "./graphics";

export class ViewerRuntime implements StudyViewer {
  private viewer: AnatomyViewer | undefined;
  private canvas = document.createElement("canvas");
  private selectionBox = document.createElement("div");
  private loadAbort: AbortController | undefined;
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  private observer: ResizeObserver;
  private unbindInput: () => void;
  private disposed = false;
  private failed = false;
  private loading = true;
  private animating = false;
  private renderFrame = 0;
  private resizePending = false;
  private autoFitScene = false;
  private lastRenderTime = -Infinity;
  private graphics: GraphicsSettings = defaultGraphics;
  private fpsFrames = 0;
  private fpsStarted = 0;
  private fpsTimer = 0;
  private orientation: Float32Array | undefined;
  private structureIds: string[] = [];
  private loadedModelIds = new Set<string>();
  private modelLoadError = false;
  private movingId = "";
  private separatedIds = new Set<string>();
  private snapTarget = "";
  private restoring = false;

  constructor(private host: HTMLElement, private options: {
    viewport: () => Viewport;
    viewportElement?: HTMLElement;
    frameOverviewToWindow?: boolean;
    onState: (patch: Partial<ViewerState>, visibleIds?: ReadonlySet<string>) => void;
    onCameraChange?: () => void;
    onPick: (id: string) => void;
    onHide: (ids: string[]) => boolean;
    allowSeparation?: boolean;
    canSeparate?: () => boolean;
    canSelect?: () => boolean;
    preserveCameraOnResize?: boolean;
    animateInitialReconstruction?: boolean;
    background?: boolean;
    onFps?: (fps: number) => void;
    onOrientation?: (axes: Float32Array) => void;
    onHold?: (point: ViewerHold | null) => void;
    onSnap?: (id: string) => void;
  }) {
    this.canvas.setAttribute("role", "img");
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    this.selectionBox.className = "model-selection-box";
    this.selectionBox.hidden = true;
    this.selectionBox.setAttribute("aria-hidden", "true");
    host.appendChild(this.selectionBox);
    this.unbindInput = bindViewerInput(this.canvas, {
      enabled: () => !this.loading && !this.animating && !this.restoring && !this.failed,
      operate: this.operate, redraw: this.scheduleRender,
      onCameraChange: this.cameraChanged,
      pick: options.onPick,
      selectable: options.canSelect,
      moving: () => this.movingId || this.separatedIds.values().next().value || "",
      movable: id => id === this.movingId || this.separatedIds.has(id),
      joined: id => (this.viewer?.structure_group(id).length ?? 0) > 1,
      detachable: () => options.allowSeparation !== false && options.canSeparate?.() !== false && !!this.viewer?.can_move_structures(),
      beginHeldDrag: (id, grouped) => this.beginHeldDrag(id, grouped), onHold: options.onHold,
      hide: options.onHide,
      onBox: rect => {
        this.selectionBox.hidden = !rect;
        if (rect) Object.assign(this.selectionBox.style, {
          left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
        });
      },
      onSnap: id => this.updateSnapTarget(id),
      endDrag: action => this.endDrag(action),
      restore: () => { this.restoreStructure(""); },
    });
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    if (options.viewportElement) this.observer.observe(options.viewportElement);
    this.motion.addEventListener("change", this.motionChanged);
    this.resolution.addEventListener("change", this.resolutionChanged);
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
  }

  async start(catalog: Catalog, modelIds?: readonly string[]) {
    this.loadAbort?.abort();
    const request = this.loadAbort = new AbortController();
    this.loading = true;
    this.autoFitScene = false;
    this.options.onState({ building: true, loadedSystems: 0, structureIds: [], selected: "", error: false, status: "loading" });
    const plan = this.planModels(catalog, modelIds);
    if (!plan) return;
    try {
      const wasm = await getWasm();
      if (this.disposed || this.loadAbort !== request) return;
      this.initializeBackground(wasm);
      if (this.options.background && !plan.bundle) {
        this.viewer!.set_visibility([]);
        this.loading = false;
        this.options.onState({ building: false, status: "finishing" });
        this.scheduleRender();
        return;
      }
      catalog.clearMetadata();
      // Fit every system before the first frame so reconstruction cannot change the scale.
      const started = performance.now();
      const animate = !this.motion.matches && this.options.animateInitialReconstruction !== false;
      if (plan.bundle) {
        for await (const { geometry, metadata } of loadModels(catalog, plan.bundle, request.signal, loadedSystems => {
          if (this.loadAbort !== request) return;
          this.options.onState({ loadedSystems, status: "preparing" });
        }, this.options.frameOverviewToWindow)) {
          if (this.disposed || this.loadAbort !== request) return;
          if (this.viewer) this.viewer.appendPrepared(geometry, this.options.background ? performance.now() : started, animate);
          else {
            this.viewer = wasm.AnatomyViewer.fromPrepared(this.canvas, geometry);
            this.viewer.begin_reconstruction(started, animate);
          }
          catalog.ingestModelMetadata(metadata);
        }
      }
      if (this.disposed || this.loadAbort !== request) return;
      this.viewer!.start_reconstruction(performance.now(), animate);
      this.resizeCanvas();
      this.viewer!.inspect("reset");
      this.setGraphics(this.graphics);
      this.viewer!.configure_explosion(plan.explosionGroups);
      if (this.options.background) this.viewer!.set_visibility([]);
      if (this.failed) throw new Error("Model rendering failed");
      catalog.finish();
      this.structureIds = catalog.identities();
      this.loading = false; this.animating = animate;
      this.options.onState({ structureIds: this.structureIds, building: animate, status: "finishing" });
      this.scheduleRender();
    } catch (cause) {
      if (!this.disposed && this.loadAbort === request) this.fail(cause, "loadError");
    }
  }

  private initializeBackground(wasm: Awaited<ReturnType<typeof getWasm>>) {
    if (!this.options.background || this.viewer) return;
    this.viewer = wasm.AnatomyViewer.background(this.canvas);
    this.resizeCanvas();
    this.setGraphics(this.graphics);
    this.viewer.render();
  }

  async updateBackgroundModels(catalog: Catalog, modelIds: readonly string[], getVisibleIds: () => ReadonlySet<string>) {
    if (this.disposed || this.failed) return;
    this.loadAbort?.abort();
    this.loadAbort = undefined;
    const plan = this.planModels(catalog, modelIds, [...this.loadedModelIds]);
    if (!plan) return;
    const { bundle, loadedCount, requestedCount, explosionGroups } = plan;
    if (this.viewer && !bundle) {
      if (!this.loading && !this.modelLoadError) return;
      this.loading = false;
      this.modelLoadError = false;
      this.options.onState({ building: false, loadedSystems: requestedCount, error: false, status: "finishing" });
      this.scheduleRender();
      return;
    }

    const request = this.loadAbort = new AbortController();
    this.loading = true;
    this.modelLoadError = false;
    this.options.onState({ building: true, loadedSystems: loadedCount, error: false, status: "loading" });
    let appending = false;
    try {
      const wasm = await getWasm();
      if (this.disposed || this.loadAbort !== request) return;
      if (!this.viewer) catalog.clearMetadata();
      this.initializeBackground(wasm);
      const viewer = this.viewer;
      if (!viewer) throw new Error("Background viewer is unavailable");
      let visibleIds: ReadonlySet<string> | undefined;
      if (bundle) {
        for await (const { geometry, metadata } of loadModels(catalog, bundle, request.signal, loaded => {
          if (this.loadAbort === request) this.options.onState({ loadedSystems: loadedCount + loaded, status: "preparing" });
        })) {
          if (this.disposed || this.loadAbort !== request) return;
          visibleIds = getVisibleIds();
          const view = this.loadedModelIds.size ? viewer.capture_view() as SceneView : undefined;
          appending = true;
          viewer.set_explode_mode(false);
          viewer.appendPrepared(geometry, performance.now(), false);
          catalog.ingestModelMetadata(metadata);
          for (const id of bundle.rootIds) this.loadedModelIds.add(id);
          catalog.finish();
          viewer.configure_explosion(explosionGroups);
          viewer.apply_scene([...visibleIds], view);
          this.structureIds = catalog.identities();
          this.clearSceneInteraction();
        }
      }
      if (this.disposed || this.loadAbort !== request) return;
      this.loadAbort = undefined;
      this.loading = false;
      this.options.onState({
        building: false, loadedSystems: requestedCount, status: "finishing",
        ...(visibleIds && { structureIds: this.structureIds, selected: "" }),
      }, visibleIds);
      this.scheduleRender();
    } catch (cause) {
      if (this.disposed || this.loadAbort !== request) return;
      if (appending || !this.viewer) {
        this.fail(cause, "loadError");
        return;
      }
      this.loadAbort = undefined;
      this.reportModelLoadError(cause);
    }
  }

  private planModels(catalog: Catalog, modelIds?: readonly string[], loaded?: readonly string[]): ModelLoadPlan | undefined {
    try {
      return catalog.modelLoadPlan(modelIds, loaded);
    } catch (cause) {
      this.loadAbort = undefined;
      this.reportModelLoadError(cause);
    }
  }

  private reportModelLoadError(cause: unknown) {
    this.loading = false;
    this.modelLoadError = true;
    console.error(cause);
    this.options.onState({ building: false, error: true, status: "loadError" });
    this.scheduleRender();
  }

  private fail(cause: unknown, status: ViewerStatus) {
    this.failed = true; this.animating = false;
    this.loadAbort?.abort();
    this.snapTarget = ""; this.options.onSnap?.("");
    this.stopFpsMeter();
    console.error(cause);
    this.options.onState({ error: true, status });
  }

  private operate = (action: (viewer: AnatomyViewer) => void | false, redraw = true) => {
    if (!this.viewer || this.failed || this.disposed) return false;
    try {
      if (action(this.viewer) === false) return false;
      this.options.onState({ selected: this.viewer.selected_id() });
      if (redraw) this.scheduleRender();
      return true;
    } catch (cause) {
      this.fail(cause, "processError");
      return false;
    }
  };

  private cameraChanged = () => {
    this.autoFitScene = false;
    this.options.onCameraChange?.();
  };

  private scheduleRender = () => {
    if (this.loading || !this.viewer || this.renderFrame || this.failed || this.disposed) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = 0;
      if (this.failed || this.disposed) return;
      const now = performance.now();
      const interval = this.graphics.frameRate === "display" ? 0 : 1000 / this.graphics.frameRate;
      const elapsed = now - this.lastRenderTime;
      if (elapsed + 0.5 < interval) { this.scheduleRender(); return; }
      this.lastRenderTime = interval > 0 && elapsed < interval * 2 ? this.lastRenderTime + interval : now;
      try {
        if (this.resizePending) this.resizeCanvas();
        const cameraAnimating = this.viewer!.advance_camera(now);
        const revealing = !this.animating && this.viewer!.advance_reconstruction(now);
        if (this.animating) {
          this.animating = this.viewer!.render_reconstruction(now);
          if (this.animating) this.scheduleRender();
          else if (!this.loading) this.options.onState({ building: false });
        } else if (this.restoring) {
          const clearMoving = this.viewer!.advance_study_restoration(now, this.movingId);
          if (clearMoving === undefined) this.scheduleRender();
          else this.finishRestoration(clearMoving);
          this.viewer!.render();
        } else if (this.viewer!.explosion_active()) {
          if (this.viewer!.render_study_explosion(now)) this.scheduleRender();
        } else this.viewer!.render();
        if (this.options.onOrientation) {
          const axes = this.viewer!.camera_axes();
          if (!this.orientation || axes.some((value, index) => value !== this.orientation![index])) {
            this.orientation = axes;
            this.options.onOrientation(axes);
          }
        }
        if (this.graphics.showFps) this.fpsFrames++;
        if (cameraAnimating || revealing) this.scheduleRender();
      } catch (cause) { this.fail(cause, "renderError"); }
    });
  };

  resize = () => {
    this.resizePending = true;
    this.scheduleRender();
  };

  private resolutionChanged = () => {
    this.resolution.removeEventListener("change", this.resolutionChanged);
    this.resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.resolution.addEventListener("change", this.resolutionChanged);
    this.resize();
  };

  private resizeCanvas() {
    this.resizePending = false;
    const { left, top, width, height } = this.host.getBoundingClientRect();
    if (width > 0 && height > 0) {
      const pose = this.options.preserveCameraOnResize && !this.loading && !this.autoFitScene
        ? this.viewer!.camera_pose() : undefined;
      const [renderWidth, renderHeight] = this.renderSize(width, height);
      if (this.canvas.width !== renderWidth || this.canvas.height !== renderHeight) this.viewer!.resize(renderWidth, renderHeight);
      this.viewer!.reframe(...this.options.viewport());
      if (this.options.frameOverviewToWindow) {
        this.viewer!.set_overview_window(window.innerHeight / height,
          (window.innerWidth - 2 * left) / width - 1, 1 - (window.innerHeight - 2 * top) / height);
      }
      if (this.autoFitScene) this.viewer!.fit_scene_frame();
      else if (this.options.viewportElement) this.viewer!.align_viewport();
      if (pose) this.viewer!.set_camera_pose(pose);
    }
  }

  private renderSize(width: number, height: number): [number, number] {
    const ratio = Math.min(window.devicePixelRatio, 2) * renderScales[this.graphics.modelQuality];
    return [Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))];
  }

  setGraphics(settings: GraphicsSettings) {
    if (settings.showFps !== this.graphics.showFps) {
      this.stopFpsMeter();
      if (settings.showFps && !this.disposed && !this.failed) {
        this.fpsStarted = performance.now();
        this.fpsTimer = window.setInterval(() => {
          const now = performance.now();
          this.options.onFps?.(Math.round(this.fpsFrames * 1000 / Math.max(1, now - this.fpsStarted)));
          this.fpsFrames = 0; this.fpsStarted = now;
        }, 1000);
      }
    }
    this.graphics = settings;
    this.lastRenderTime = -Infinity;
    if (!this.viewer) return !this.disposed && !this.failed;
    const { width, height } = this.host.getBoundingClientRect();
    const shadowLevel = settings.shadowQuality === "off" ? 0 : settings.shadowQuality === "low" ? 1 : 2;
    return this.operate(viewer => viewer.set_graphics(shadowLevel, qualityLevels[settings.lightingQuality], settings.grid,
      ...this.renderSize(width, height)));
  }

  private stopFpsMeter() {
    window.clearInterval(this.fpsTimer); this.fpsTimer = 0; this.fpsFrames = 0;
    this.options.onFps?.(0);
  }

  private animationTime() { return this.motion.matches ? undefined : performance.now(); }

  private motionChanged = () => {
    if (!this.loading && this.motion.matches && this.viewer) {
      this.viewer.finish_reconstruction(); this.animating = false; this.scheduleRender();
      this.viewer.finish_explosion(); this.viewer.finish_camera_transition();
      if (this.restoring) {
        this.operate(viewer => this.finishRestoration(viewer.finish_study_restoration(this.movingId)));
      }
      if (!this.loading) this.options.onState({ building: false });
    }
  };

  private contextLost = (event: Event) => {
    event.preventDefault();
    this.fail(new Error("WebGL context lost"), "contextLost");
  };

  select(id: string) { return this.operate(viewer => {
    if (!viewer.selection_ids().includes(id)) viewer.clear_selection();
    viewer.select(id);
  }); }

  private publishSeparation() {
    if (this.viewer) this.separatedIds = new Set(this.viewer.separated_ids());
    this.options.onState({ movingId: this.movingId, separatedIds: new Set(this.separatedIds) });
  }

  private updateSnapTarget(target: string) {
    if (target !== this.snapTarget) { this.snapTarget = target; this.options.onSnap?.(target); }
  }

  private clearSnapTarget() {
    if (!this.snapTarget) return;
    this.operate(viewer => { viewer.preview_connection(""); });
    this.updateSnapTarget("");
  }

  private beginHeldDrag(id: string, grouped: boolean) {
    if (!this.operate(viewer => { if (!viewer.begin_held_study_drag(id, grouped)) return false; })) return false;
    this.updateMoving(id);
    this.publishSeparation();
    return true;
  }

  private endDrag(action: DragEnd) {
    const success = this.operate(viewer => {
      if (action === "cancel") viewer.cancel_study_drag();
      else if (viewer.finish_study_drag(action === "drop", this.movingId)) this.updateMoving("");
    });
    this.updateSnapTarget("");
    if (success) this.publishSeparation();
  }

  setMoving(id: string, selectedOnly = false) {
    if (id && (this.loading || this.animating || !this.structureIds.includes(id))) return false;
    if (!this.operate(viewer => { if (!viewer.select_for_movement(id, selectedOnly)) return false; })) return false;
    this.updateMoving(id);
    this.publishSeparation();
    return true;
  }

  private updateMoving(id: string) {
    if (id) this.autoFitScene = false;
    this.movingId = id;
    this.canvas.dataset.moving = id ? "true" : "false";
    this.canvas.dataset.draggable = "false";
  }

  restoreStructure(id: string) {
    return this.operate(viewer => {
      const clearMoving = viewer.begin_study_restoration(id, performance.now(), !this.motion.matches, this.movingId);
      this.updateSnapTarget("");
      this.restoring = clearMoving === undefined;
      if (clearMoving !== undefined) this.finishRestoration(clearMoving);
    });
  }

  private finishRestoration(clearMoving: boolean) {
    this.restoring = false;
    if (clearMoving) this.updateMoving("");
    this.publishSeparation();
  }

  changeVisibility(ids: string[], shown: boolean) {
    this.clearSnapTarget();
    if (!shown && ids.includes(this.movingId)) this.setMoving("");
    let visibility: VisibilityUpdate | undefined;
    const success = this.operate(viewer => {
      visibility = viewer.change_study_visibility(ids, shown, this.animationTime());
    });
    return success ? visibility : undefined;
  }

  captureView(): SceneView | undefined {
    if (this.movingId || this.separatedIds.size) return undefined;
    let view: SceneView | undefined;
    this.operate(viewer => { view = viewer.capture_view() as SceneView; });
    return view;
  }

  applyScene(ids: string[], view?: SceneView) {
    const response: { result?: { visibility: VisibilityUpdate; fit: boolean } } = {};
    const success = this.operate(viewer => {
      response.result = viewer.apply_study_scene(ids, view, this.options.viewportElement ? this.options.viewport() : undefined, this.animationTime());
      if (!response.result) return false;
    });
    if (!success || !response.result) return;
    this.autoFitScene = response.result.fit;
    this.clearSceneInteraction();
    return response.result.visibility;
  }

  private clearSceneInteraction() {
    this.restoring = false;
    this.movingId = "";
    this.snapTarget = "";
    this.options.onSnap?.("");
    this.options.onHold?.(null);
    this.separatedIds.clear();
    this.canvas.dataset.moving = "false";
    this.publishSeparation();
  }

  focus(ids: string[], folder: boolean) {
    this.clearSnapTarget();
    if (this.movingId) this.setMoving("");
    const motionTime = this.animationTime();
    let visibility: VisibilityUpdate | undefined;
    const success = this.operate(viewer => {
      const result: { visibility: VisibilityUpdate } = viewer.focus_scene(ids, folder, this.options.viewport(), motionTime);
      visibility = result.visibility;
      this.cameraChanged();
    });
    return success ? visibility : undefined;
  }

  setExplosion(value: number, ids: string[]) {
    return this.operate(viewer => {
      const frame = value > 0 && !viewer.explosion_active() ? this.options.viewport() : undefined;
      if (!viewer.set_study_explosion(value / 100, ids, frame, performance.now(), !this.motion.matches, !!this.movingId)) return false;
      if (value > 0) this.autoFitScene = false;
    });
  }

  retargetExplosion(value: number, ids: string[]) {
    if (this.viewer?.explosion_active()) this.setExplosion(value, ids);
  }

  centerReader(expanded: boolean, viewport: Viewport) {
    this.operate(viewer => {
      if (viewer.explosion_active()) viewer.reframe(...viewport);
      const now = this.animationTime();
      if (expanded) viewer.center(viewport[0] + viewport[2] / 2, viewport[1] + viewport[3] / 2, now);
      else viewer.clear_center(now);
    });
  }

  overview() {
    this.clearSnapTarget();
    let visibility: VisibilityUpdate | undefined;
    const success = this.operate(viewer => {
      visibility = viewer.reset_study_scene(this.structureIds, performance.now(), !this.motion.matches);
      this.cameraChanged();
    });
    if (success) {
      this.restoring = false;
      this.movingId = "";
      this.separatedIds.clear();
      this.canvas.dataset.moving = "false";
      this.publishSeparation();
    }
    return success ? visibility : undefined;
  }

  control(commands: CameraCommand[]) {
    return this.operate(viewer => {
      for (const command of commands) {
        switch (command.kind) {
          case "pan": viewer.pan(command.x, command.y); break;
          case "rotate": viewer.rotate(command.x, command.y); break;
          case "zoom": viewer.zoom(command.factor); break;
          case "orient": viewer.orient(command.axis, command.direction, this.animationTime()); break;
          case "reset": viewer.inspect("reset", this.animationTime()); break;
        }
      }
      if (commands.length) this.cameraChanged();
    });
  }

  dispose() {
    this.disposed = true; this.loading = true; this.animating = false;
    this.loadAbort?.abort(); this.observer.disconnect(); this.unbindInput();
    this.motion.removeEventListener("change", this.motionChanged);
    this.resolution.removeEventListener("change", this.resolutionChanged);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    cancelAnimationFrame(this.renderFrame); this.renderFrame = 0;
    this.stopFpsMeter();
    this.viewer?.free(); this.viewer = undefined; this.canvas.remove(); this.selectionBox.remove();
  }
}
