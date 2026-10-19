import type { Structure, StudyTarget } from "../catalog/types";
import { structureName } from "../anatomy-names";
import { getWasm } from "../core";
import type { AnatomyViewer } from "../wasm/anatomy_wasm";
import type { CameraCommand, StudyViewer, ViewerState, Viewport } from "./contracts";
import { bindViewerInput } from "./input";
import { loadModels } from "./loader";
import { defaultGraphics, qualityLevels, renderScales } from "./graphics";
import type { GraphicsSettings } from "./graphics";

const RESTORE_DURATION = 420;

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
  private cameraAnimating = false;
  private renderFrame = 0;
  private lastRenderTime = -Infinity;
  private graphics: GraphicsSettings = defaultGraphics;
  private fpsFrames = 0;
  private fpsStarted = 0;
  private fpsTimer = 0;
  private meshes: Structure[] = [];
  private movingId = "";
  private separatedIds = new Set<string>();
  private restoration: { started: number; offsets: Map<string, Float32Array>; all: boolean } | undefined;

  constructor(private host: HTMLElement, private options: {
    viewport: () => Viewport;
    frame: () => DOMRect;
    onState: (patch: Partial<ViewerState>) => void;
    onPick: (id: string) => void;
    onFps?: (fps: number) => void;
  }) {
    this.canvas.setAttribute("role", "img");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "Mô hình 3D cơ thể người. W A S D để di chuyển camera lên, trái, xuống, phải; phím mũi tên để xoay mô hình. E để phóng to, Q để thu nhỏ theo tâm màn hình, R để đặt lại. Kéo để xoay, Shift và kéo để dịch mô hình, cuộn để phóng to theo vị trí chuột, trỏ vào để xem thông tin.");
    host.appendChild(this.canvas);
    this.unbindInput = bindViewerInput(this.canvas, {
      enabled: () => !this.loading && !this.animating && !this.restoration && !this.failed,
      frame: options.frame, operate: this.operate, redraw: this.scheduleRender,
      pick: options.onPick,
      moving: () => this.movingId || this.separatedIds.values().next().value || "",
      movable: id => id === this.movingId || this.separatedIds.has(id),
      moved: id => this.publishSeparation(id),
      restore: () => { this.restoreStructure(""); },
    });
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.motion.addEventListener("change", this.motionChanged);
    this.canvas.addEventListener("webglcontextlost", this.contextLost);
  }

  async start(roots: StudyTarget[]) {
    this.options.onState({ building: true, loadedSystems: 0, meshes: [], selected: "", error: false, status: "Đang nạp mô hình…" });
    try {
      const wasm = await getWasm();
      if (this.disposed) return;
      const packages = await loadModels(roots, this.abort.signal, loadedSystems => {
        this.options.onState({ loadedSystems, status: `Đang chuẩn bị cơ thể · ${loadedSystems}/${roots.length} hệ đã nạp` });
      });
      if (this.disposed) return;
      // Fit every system before the first frame so reconstruction cannot change the scale.
      const now = performance.now(), animate = !this.motion.matches;
      for (const pkg of packages) {
        if (this.viewer) this.viewer.appendPrepared(pkg.prepared, now, animate);
        else {
          this.viewer = wasm.AnatomyViewer.fromPrepared(this.canvas, pkg.prepared);
          this.viewer.begin_reconstruction(now, animate);
        }
      }
      this.resize();
      this.setGraphics(this.graphics);
      this.viewer!.configure_explosion(JSON.stringify(roots.map(root => root.model!.structure_ids)));
      if (this.failed) throw new Error("Model rendering failed");
      this.meshes = [...new Map(packages.flatMap(pkg => pkg.structures).map(part => [part.source_id, part])).values()]
        .sort((a, b) => structureName(a).localeCompare(structureName(b), "vi") || a.source_object.localeCompare(b.source_object));
      this.loading = false; this.animating = animate;
      this.options.onState({ meshes: this.meshes, building: animate, status: "Đang hoàn thiện cơ thể…" });
      this.scheduleRender();
    } catch (cause) {
      if (!this.disposed) this.fail(cause, "Không nạp được mô hình. Hãy tải lại trang để thử lại.");
    }
  }

  private fail(cause: unknown, status: string) {
    this.failed = true; this.animating = false; this.abort.abort();
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
      this.fail(cause, "Không thể xử lý mô hình. Hãy tải lại trang để thử lại.");
      return false;
    }
  };

  private scheduleRender = () => {
    if (!this.viewer || this.renderFrame || this.failed || this.disposed) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = 0;
      if (this.failed || this.disposed) return;
      const now = performance.now();
      const interval = 1000 / this.graphics.frameRate;
      if (now - this.lastRenderTime + 0.5 < interval) { this.scheduleRender(); return; }
      this.lastRenderTime = now;
      try {
        this.cameraAnimating = this.viewer!.advance_camera(now);
        const revealing = !this.animating && this.viewer!.advance_reconstruction(now);
        if (this.animating) {
          this.animating = this.viewer!.render_reconstruction(now);
          if (this.animating) this.scheduleRender();
          else if (!this.loading) this.options.onState({ building: false });
        } else if (this.restoration) {
          const progress = Math.min(1, (now - this.restoration.started) / RESTORE_DURATION);
          const remaining = (1 - progress) ** 3;
          if (progress < 1) {
            for (const [id, offset] of this.restoration.offsets) {
              this.viewer!.restore_structure(id, offset.map(value => value * remaining));
            }
            this.viewer!.render();
            this.scheduleRender();
          } else {
            if (this.restoration.all) this.viewer!.restore_structure("");
            else for (const id of this.restoration.offsets.keys()) this.viewer!.restore_structure(id);
            this.finishRestoration();
            this.viewer!.render();
          }
        } else if (this.exploding) {
          if (this.viewer!.render_explosion(now)) this.scheduleRender();
          else if (this.reassembling) {
            this.viewer!.set_explode_mode(false);
            this.exploding = false; this.reassembling = false;
          }
        } else this.viewer!.render();
        if (this.graphics.showFps) this.fpsFrames++;
        if (this.cameraAnimating || revealing) this.scheduleRender();
      } catch (cause) { this.fail(cause, "Không thể hiển thị mô hình. Hãy tải lại trang để thử lại."); }
    });
  };

  private resize = () => {
    const { width, height } = this.host.getBoundingClientRect();
    if (width > 0 && height > 0) {
      const ratio = Math.min(window.devicePixelRatio, 2) * renderScales[this.graphics.modelQuality];
      this.operate(viewer => {
        viewer.resize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
        viewer.reframe(...this.options.viewport());
      });
    }
  };

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
    const ratio = Math.min(window.devicePixelRatio, 2) * renderScales[settings.modelQuality];
    return this.operate(viewer => viewer.set_graphics(shadowLevel, qualityLevels[settings.lightingQuality], settings.grid,
      Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))));
  }

  private stopFpsMeter() {
    window.clearInterval(this.fpsTimer); this.fpsTimer = 0; this.fpsFrames = 0;
    this.options.onFps?.(0);
  }

  private animationTime() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? undefined : performance.now(); }

  private motionChanged = () => {
    if (this.motion.matches && this.viewer) {
      this.viewer.finish_reconstruction(); this.animating = false; this.scheduleRender();
      this.viewer.finish_explosion(); this.viewer.finish_camera_transition(); this.cameraAnimating = false;
      if (this.restoration) {
        const { offsets, all } = this.restoration;
        this.operate(viewer => {
          if (all) viewer.restore_structure("");
          else for (const id of offsets.keys()) viewer.restore_structure(id);
        });
        this.finishRestoration();
      }
      if (!this.loading) this.options.onState({ building: false });
    }
  };

  private contextLost = (event: Event) => {
    event.preventDefault();
    this.fail(new Error("WebGL context lost"), "Kết nối hiển thị 3D bị mất. Hãy tải lại trang.");
  };

  select(id: string) { return this.operate(viewer => viewer.select(id)); }

  hitTest(x: number, y: number) {
    if (this.loading || this.animating || this.failed) return "";
    const bounds = this.canvas.getBoundingClientRect();
    let id = "";
    this.operate(viewer => {
      const before = viewer.selected_id();
      id = viewer.pick(Math.floor((x - bounds.left) / bounds.width * this.canvas.width),
        this.canvas.height - 1 - Math.floor((y - bounds.top) / bounds.height * this.canvas.height));
      viewer.select(before);
    }, false);
    return id;
  }

  private publishSeparation(id = this.movingId) {
    if (this.viewer && id) {
      if (this.viewer.structure_offset(id).some(value => value !== 0)) this.separatedIds.add(id);
      else this.separatedIds.delete(id);
    }
    this.options.onState({ movingId: this.movingId, separatedIds: new Set(this.separatedIds) });
  }

  setMoving(id: string) {
    if (id && this.reassembling) {
      if (!this.operate(viewer => { viewer.finish_explosion(); viewer.set_explode_mode(false); })) return false;
      this.exploding = false; this.reassembling = false;
    }
    if (id && (this.loading || this.animating || this.exploding || !this.meshes.some(part => part.source_id === id))) return false;
    if (!this.operate(viewer => viewer.select(id || viewer.selected_id()))) return false;
    this.movingId = id;
    this.canvas.dataset.moving = id ? "true" : "false";
    this.canvas.dataset.draggable = "false";
    this.publishSeparation();
    return true;
  }

  restoreStructure(id: string) {
    const all = !id || this.restoration?.all === true;
    const ids = new Set(this.restoration?.offsets.keys());
    if (id) ids.add(id);
    else {
      for (const separatedId of this.separatedIds) ids.add(separatedId);
      if (this.movingId) ids.add(this.movingId);
    }
    const offsets = new Map([...ids].map(target => [target, this.viewer?.structure_offset(target) ?? new Float32Array(3)]));
    if (this.motion.matches || ![...offsets.values()].some(offset => offset.some(value => value !== 0))) {
      if (!this.operate(viewer => viewer.restore_structure(all ? "" : id))) return false;
      this.restoration = { started: 0, offsets, all };
      this.finishRestoration();
      return true;
    }
    this.restoration = { started: performance.now(), offsets, all };
    this.scheduleRender();
    return true;
  }

  private finishRestoration() {
    const restoration = this.restoration;
    if (!restoration) return;
    this.restoration = undefined;
    if (restoration.all) this.separatedIds.clear();
    else for (const id of restoration.offsets.keys()) this.separatedIds.delete(id);
    if (restoration.all || restoration.offsets.has(this.movingId)) this.setMoving("");
    else this.publishSeparation();
  }

  changeVisibility(ids: string[], shown: boolean) {
    if (!shown && ids.includes(this.movingId)) this.setMoving("");
    return this.operate(viewer => viewer.change_visibility(JSON.stringify(ids), shown, this.animationTime()));
  }

  focus(ids: string[], folder: boolean, reveal: boolean) {
    if (this.movingId) this.setMoving("");
    return this.operate(viewer => {
      if (folder) {
        const now = this.animationTime(), focused = new Set(ids);
        if (reveal) {
          viewer.change_visibility(JSON.stringify(ids), false);
          viewer.change_visibility(JSON.stringify(ids), true, now);
        }
        viewer.change_visibility(JSON.stringify(this.meshes.filter(part => !focused.has(part.source_id)).map(part => part.source_id)), false, now);
      } else if (ids.length === 1) viewer.set_visibility(JSON.stringify(ids));
      viewer.focus(JSON.stringify(ids), ...this.options.viewport());
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
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches, !ids.length, JSON.stringify(ids));
    });
  }

  retargetExplosion(value: number, ids: string[]) {
    if (this.exploding) this.setExplosion(value, ids);
  }

  centerReader(expanded: boolean) {
    const viewport = this.options.viewport();
    this.operate(viewer => {
      if (this.exploding) viewer.reframe(...viewport);
      const now = this.animationTime();
      if (expanded) viewer.center(viewport[0] + viewport[2] / 2, viewport[1] + viewport[3] / 2, now);
      else viewer.clear_center(now);
      this.cameraAnimating = now !== undefined;
    });
  }

  overview() {
    const success = this.operate(viewer => {
      viewer.clear_center(); viewer.select("");
      viewer.restore_structure("");
      if (this.exploding) {
        viewer.set_explode(0, performance.now(), false, false); viewer.set_explode_mode(false);
      }
      viewer.set_visibility(JSON.stringify(this.meshes.map(part => part.source_id))); viewer.inspect("reset");
    });
    if (success) { this.exploding = false; this.reassembling = false; this.cameraAnimating = false;
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
          case "reset": viewer.inspect("reset", this.animationTime()); break;
        }
      }
    });
  }

  dispose() {
    this.disposed = true; this.loading = true; this.animating = false; this.cameraAnimating = false;
    this.abort.abort(); this.observer.disconnect(); this.unbindInput();
    this.motion.removeEventListener("change", this.motionChanged);
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    cancelAnimationFrame(this.renderFrame); this.renderFrame = 0;
    this.stopFpsMeter();
    this.viewer?.free(); this.viewer = undefined; this.canvas.remove();
  }
}
