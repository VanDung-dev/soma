import type { Catalog, StudyTarget } from "../catalog/types";
import { getWasm } from "../core";
import type { AnatomyViewer } from "../../wasm/wasm";
import type { CameraCommand, StudyViewer, ViewerState, ViewerStatus, Viewport } from "./contracts";
import { bindViewerInput } from "./input";
import { loadModels } from "./loader";
import { defaultGraphics, qualityLevels, renderScales } from "./graphics";
import type { GraphicsSettings } from "./graphics";

export class ViewerRuntime implements StudyViewer {
  private viewer: AnatomyViewer | undefined;
  private canvas = document.createElement("canvas");
  private abort = new AbortController();
  private motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private observer: ResizeObserver;
  private unbindInput: () => void;
  private disposed = false;
  private failed = false;
  private loading = true;
  private animating = false;
  private exploding = false;
  private reassembling = false;
  private renderFrame = 0;
  private resizePending = false;
  private lastRenderTime = -Infinity;
  private graphics: GraphicsSettings = defaultGraphics;
  private fpsFrames = 0;
  private fpsStarted = 0;
  private fpsTimer = 0;
  private orientation: Float32Array | undefined;
  private structureIds: string[] = [];
  private movingId = "";
  private separatedIds = new Set<string>();
  private snapTarget = "";
  private restoration: { ids: Set<string>; all: boolean } | undefined;

  constructor(private host: HTMLElement, private options: {
    viewport: () => Viewport;
    onState: (patch: Partial<ViewerState>) => void;
    onPick: (id: string) => void;
    onFps?: (fps: number) => void;
    onOrientation?: (axes: Float32Array) => void;
    onHold?: (point: { x: number; y: number } | null) => void;
    onSnap?: (id: string) => void;
  }) {
    this.canvas.setAttribute("role", "img");
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    this.unbindInput = bindViewerInput(this.canvas, {
      enabled: () => !this.loading && !this.animating && !this.restoration && !this.failed,
      operate: this.operate, redraw: this.scheduleRender,
      pick: options.onPick,
      moving: () => this.movingId || this.separatedIds.values().next().value || "",
      movable: id => id === this.movingId || this.separatedIds.has(id),
      joined: id => (this.viewer?.structure_group(id).length ?? 0) > 1,
      detachable: () => !this.exploding || this.reassembling,
      detach: id => this.setMoving(id) && this.operate(viewer => viewer.detach_structure(id)), onHold: options.onHold,
      snap: (id, commit) => this.snapStructure(id, commit),
      moved: () => this.publishSeparation(),
      restore: () => { this.restoreStructure(""); },
    });
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.motion.addEventListener("change", this.motionChanged);
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
  }

  async start(catalog: Catalog, roots: StudyTarget[] = catalog.roots) {
    this.options.onState({ building: true, loadedSystems: 0, structureIds: [], selected: "", error: false, status: "loading" });
    try {
      const wasm = await getWasm();
      if (this.disposed) return;
      catalog.clearMetadata();
      const packages = loadModels(roots, this.abort.signal, loadedSystems => {
        this.options.onState({ loadedSystems, status: "preparing" });
      }, (root, json) => catalog.ingestMetadata(root, json));
      // Fit every system before the first frame so reconstruction cannot change the scale.
      const started = performance.now();
      for await (const prepared of packages) {
        if (this.disposed) return;
        if (this.viewer) this.viewer.appendPrepared(prepared, started, true);
        else {
          this.viewer = wasm.AnatomyViewer.fromPrepared(this.canvas, prepared);
          this.viewer.begin_reconstruction(started, true);
        }
      }
      if (this.disposed) return;
      const animate = !this.motion.matches;
      this.viewer!.start_reconstruction(performance.now(), animate);
      this.resizeCanvas();
      this.viewer!.inspect("reset");
      this.setGraphics(this.graphics);
      this.viewer!.configure_explosion(roots.map(root => catalog.members(root.id)));
      if (this.failed) throw new Error("Model rendering failed");
      catalog.finish();
      this.structureIds = catalog.identities();
      this.loading = false; this.animating = animate;
      this.options.onState({ structureIds: this.structureIds, building: animate, status: "finishing" });
      this.scheduleRender();
    } catch (cause) {
      if (!this.disposed) this.fail(cause, "loadError");
    }
  }

  private fail(cause: unknown, status: ViewerStatus) {
    this.failed = true; this.animating = false; this.abort.abort();
    this.snapTarget = ""; this.options.onSnap?.("");
    this.stopFpsMeter();
    console.error(cause);
    this.options.onState({ error: true, status });
  }

  private operate = (action: (viewer: AnatomyViewer) => void, redraw = true) => {
    if (!this.viewer || this.failed || this.disposed) return false;
    try {
      action(this.viewer);
      this.options.onState({ selected: this.viewer.selected_id() });
      if (redraw) this.scheduleRender();
      return true;
    } catch (cause) {
      this.fail(cause, "processError");
      return false;
    }
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
        } else if (this.restoration) {
          if (this.viewer!.advance_restoration(now)) this.scheduleRender();
          else this.finishRestoration();
          this.viewer!.render();
        } else if (this.exploding) {
          if (this.viewer!.render_explosion(now)) this.scheduleRender();
          else if (this.reassembling) {
            this.viewer!.set_explode_mode(false);
            this.exploding = false; this.reassembling = false;
          }
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

  private resize = () => {
    this.resizePending = true;
    this.scheduleRender();
  };

  private resizeCanvas() {
    this.resizePending = false;
    const { width, height } = this.host.getBoundingClientRect();
    if (width > 0 && height > 0) {
      const [renderWidth, renderHeight] = this.renderSize(width, height);
      if (this.canvas.width !== renderWidth || this.canvas.height !== renderHeight) this.viewer!.resize(renderWidth, renderHeight);
      this.viewer!.reframe(...this.options.viewport());
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
      if (this.restoration) {
        this.operate(viewer => viewer.finish_restoration());
        this.finishRestoration();
      }
      if (!this.loading) this.options.onState({ building: false });
    }
  };

  private contextLost = (event: Event) => {
    event.preventDefault();
    this.fail(new Error("WebGL context lost"), "contextLost");
  };

  select(id: string) { return this.operate(viewer => viewer.select(id)); }

  private publishSeparation() {
    if (this.viewer) this.separatedIds = new Set(this.viewer.separated_ids());
    this.options.onState({ movingId: this.movingId, separatedIds: new Set(this.separatedIds) });
  }

  private snapStructure(id: string, commit: boolean) {
    if (!id && !this.snapTarget) return;
    let target = "", anchored = false;
    this.operate(viewer => {
      const members = commit ? viewer.structure_group(id) : [];
      target = commit ? viewer.connect_structure(id) : viewer.preview_connection(id);
      anchored = !!target && commit && members.includes(this.movingId) && !viewer.structure_offset(id).some(value => value !== 0);
    });
    if (anchored) this.setMoving("");
    if (commit) target = "";
    if (target !== this.snapTarget) { this.snapTarget = target; this.options.onSnap?.(target); }
  }

  setMoving(id: string) {
    if (id && this.reassembling) {
      if (!this.operate(viewer => { viewer.finish_explosion(); viewer.set_explode_mode(false); })) return false;
      this.exploding = false; this.reassembling = false;
    }
    if (id && (this.loading || this.animating || this.exploding || !this.structureIds.includes(id))) return false;
    if (!this.operate(viewer => viewer.select(id || viewer.selected_id()))) return false;
    this.movingId = id;
    this.canvas.dataset.moving = id ? "true" : "false";
    this.canvas.dataset.draggable = "false";
    this.publishSeparation();
    return true;
  }

  restoreStructure(id: string) {
    this.snapStructure("", false);
    const all = !id || this.restoration?.all === true;
    return this.operate(viewer => {
      const ids = viewer.begin_restoration(id, performance.now(), !this.motion.matches);
      this.restoration = { ids: new Set(ids), all };
      if (!viewer.restoration_active()) this.finishRestoration();
    });
  }

  private finishRestoration() {
    const restoration = this.restoration;
    if (!restoration) return;
    this.restoration = undefined;
    if (restoration.all || restoration.ids.has(this.movingId)) this.setMoving("");
    else this.publishSeparation();
  }

  changeVisibility(ids: string[], shown: boolean) {
    this.snapStructure("", false);
    if (!shown && ids.includes(this.movingId)) this.setMoving("");
    return this.operate(viewer => viewer.change_visibility(ids, shown, this.animationTime()));
  }

  focus(ids: string[], folder: boolean, reveal: boolean) {
    this.snapStructure("", false);
    if (this.movingId) this.setMoving("");
    const motionTime = this.animationTime();
    return this.operate(viewer => {
      if (folder) {
        const now = motionTime, focused = new Set(ids);
        if (reveal) {
          viewer.change_visibility(ids, false);
          viewer.change_visibility(ids, true, now);
        }
        viewer.change_visibility(this.structureIds.filter(id => !focused.has(id)), false, now);
      } else if (ids.length === 1) viewer.set_visibility(ids);
      if (motionTime === undefined) viewer.focus(ids, ...this.options.viewport());
      else viewer.focus_animated(ids, ...this.options.viewport(), motionTime);
      viewer.select(!folder && ids.length === 1 ? ids[0]! : "");
    });
  }

  setExplosion(value: number, ids: string[]) {
    if (this.movingId || this.separatedIds.size) return false;
    return this.operate(viewer => {
      if (value > 0 && !this.exploding) {
        viewer.set_explode_mode(true); this.exploding = true;
        viewer.reframe(...this.options.viewport());
      }
      this.reassembling = value === 0 && this.exploding;
      if (this.exploding) viewer.set_explode(value / 100, performance.now(),
        !this.motion.matches, !ids.length, ids);
    });
  }

  retargetExplosion(value: number, ids: string[]) {
    if (this.exploding) this.setExplosion(value, ids);
  }

  centerReader(expanded: boolean, viewport: Viewport) {
    this.operate(viewer => {
      if (this.exploding) viewer.reframe(...viewport);
      const now = this.animationTime();
      if (expanded) viewer.center(viewport[0] + viewport[2] / 2, viewport[1] + viewport[3] / 2, now);
      else viewer.clear_center(now);
    });
  }

  overview() {
    this.snapStructure("", false);
    const success = this.operate(viewer => {
      viewer.clear_center(); viewer.select("");
      viewer.restore_structure("");
      if (this.exploding) {
        viewer.set_explode(0, performance.now(), false, false); viewer.set_explode_mode(false);
      }
      const now = this.animationTime();
      viewer.change_visibility(this.structureIds, true, now); viewer.inspect("reset", now);
    });
    if (success) { this.exploding = false; this.reassembling = false;
      this.restoration = undefined;
      this.movingId = ""; this.separatedIds.clear(); this.canvas.dataset.moving = "false"; this.publishSeparation(); }
    return success;
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
    });
  }

  dispose() {
    this.disposed = true; this.loading = true; this.animating = false;
    this.abort.abort(); this.observer.disconnect(); this.unbindInput();
    this.motion.removeEventListener("change", this.motionChanged);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    cancelAnimationFrame(this.renderFrame); this.renderFrame = 0;
    this.stopFpsMeter();
    this.viewer?.free(); this.viewer = undefined; this.canvas.remove();
  }
}
