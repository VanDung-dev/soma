import { useEffect, useId, useRef, useState } from "react";
import { getWasm } from "./core";
import type { Catalog } from "./core";
import { StructureTree } from "./structure-tree";
import { StructureSearch } from "./structure-search";
import { ModelControls } from "./model-controls";
import { MenuBar } from "./menu-bar";
import { ExplodeControls } from "./explode-controls";
import { WikipediaReader } from "./wikipedia-reader";
import { anatomyNames, structureName, targetName } from "./anatomy-names";
import type { AnatomyViewer } from "./wasm/anatomy_wasm";

export interface Structure { source_id: string; source_name: string; source_object: string; latin: string; laterality: string; collections: string[] }

export function ModelViewer({ catalog }: { catalog: Catalog }) {
  const helpId = useId();
  const roots = catalog.targets.filter(target => !target.parent_id && target.model);
  const [targetId, setTargetId] = useState<string>();
  const [focusedIds, setFocusedIds] = useState<string[]>([]);
  const target = catalog.targets.find(target => target.id === targetId);
  const host = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<HTMLDivElement>(null);
  const viewer = useRef<AnatomyViewer | null>(null);
  const renderFrame = useRef(0);
  const loading = useRef(true);
  const animating = useRef(false);
  const cameraAnimating = useRef(false);
  const failed = useRef(false);
  const lastAnimationFrame = useRef(0);
  const explosionMode = useRef(false);
  const reassembling = useRef(false);
  const [explosionAmount, setExplosionAmount] = useState(0);
  const [building, setBuilding] = useState(true);
  const [loadedSystems, setLoadedSystems] = useState(0);

  const [status, setStatus] = useState("Đang nạp mô hình…");
  const [error, setError] = useState(false);
  const [meshes, setMeshes] = useState<Structure[]>([]);
  const [readerExpanded, setReaderExpanded] = useState(false);
  const readerToggle = useRef<HTMLButtonElement>(null);
  const [readingId, setReadingId] = useState("");
  const [selected, setSelected] = useState("");
  const [hovered, setHovered] = useState("");
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [reveal, setReveal] = useState<{ id: string }>();
  const focusViewport = (): [number, number, number, number] => {
    const area = host.current!.getBoundingClientRect();
    const catalogPanel = document.querySelector<HTMLElement>(".catalog-panel")!;
    const informationPanel = document.querySelector<HTMLElement>(".information-panel")!;
    const desktop = window.matchMedia("(min-width: 901px)").matches;
    const left = desktop ? catalogPanel.getBoundingClientRect().right - area.left + 12 : 12;
    const right = desktop ? informationPanel.getBoundingClientRect().left - area.left - 12 : area.width - 12;
    const frameTop = desktop ? catalogPanel.getBoundingClientRect().top - area.top : 16;
    const frameBottom = desktop ? catalogPanel.getBoundingClientRect().bottom - area.top : area.height - 16;
    Object.assign(focusFrame.current!.style, { left: `${left}px`, top: `${frameTop}px`, width: `${Math.max(1, right - left)}px`, height: `${Math.max(1, frameBottom - frameTop)}px` });
    const hud = host.current!.parentElement!.querySelector<HTMLElement>(".model-hud")!.getBoundingClientRect();
    // Reserve the controls inside the frame when fitting anatomy to the camera.
    const top = 110, bottom = Math.max(top + 1, hud.top - area.top - 12);
    return [left / area.width, top / area.height, Math.max(1, right - left) / area.width, Math.max(1, bottom - top) / area.height];
  };
  useEffect(() => {
    if (!readerExpanded) return;
    const closeReader = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setReaderExpanded(false);
      readerToggle.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", closeReader);
    return () => document.removeEventListener("keydown", closeReader);
  }, [readerExpanded]);
  useEffect(() => {
    const canvas = host.current!;
    const catalog = document.querySelector<HTMLElement>(".catalog-panel")!;
    const information = document.querySelector<HTMLElement>(".information-panel")!;
    const hud = canvas.parentElement!.querySelector<HTMLElement>(".model-hud")!;
    const centerControls = () => {
      const viewport = focusViewport();
      if (!building && !error) {
        if (explosionMode.current) operate(renderer => renderer.reframe(...viewport));
        const now = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? undefined : performance.now();
        if (readerExpanded) {
          const [left, top, width, height] = focusViewport();
          operate(renderer => { renderer.center(left + width / 2, top + height / 2, now); cameraAnimating.current = now !== undefined; });
        } else operate(renderer => { renderer.clear_center(now); cameraAnimating.current = now !== undefined; });
      }
    };
    const observer = new ResizeObserver(centerControls);
    for (const element of [canvas, catalog, information, hud]) observer.observe(element);
    centerControls();
    return () => observer.disconnect();
  }, [building, error, selected, readerExpanded]);
  const scheduleRender = () => {
    if (!viewer.current || renderFrame.current || failed.current) return;
    renderFrame.current = requestAnimationFrame(() => {
      renderFrame.current = 0;
      if (failed.current) return;
      const now = performance.now();
      try {
        cameraAnimating.current = viewer.current!.advance_camera(now);
        const revealing = !animating.current && viewer.current!.advance_reconstruction(now);
        if (animating.current) {
          if (now - lastAnimationFrame.current >= 1000 / 30) {
            lastAnimationFrame.current = now;
            animating.current = viewer.current!.render_reconstruction(now);
          }
          if (animating.current) scheduleRender();
          else if (!loading.current) setBuilding(false);
        } else if (explosionMode.current) {
          if (viewer.current!.render_explosion(now)) scheduleRender();
          else if (reassembling.current) {
            viewer.current!.set_explode_mode(false);
            explosionMode.current = false; reassembling.current = false;
          }
        } else viewer.current?.render();
        if (cameraAnimating.current || revealing) scheduleRender();
      }
      catch (cause) { failed.current = true; animating.current = false; console.error(cause); setError(true); setStatus("Không thể hiển thị mô hình. Hãy tải lại trang để thử lại."); }
    });
  };
  const operate = (action: (renderer: AnatomyViewer) => void, redraw = true) => {
    const renderer = viewer.current;
    if (!renderer || failed.current) return false;
    try {
      action(renderer);
      setSelected(renderer.selected_id());
      if (redraw) scheduleRender();
      return true;
    } catch (cause) {
      failed.current = true; animating.current = false; console.error(cause); setError(true); setStatus("Không thể xử lý mô hình. Hãy tải lại trang để thử lại.");
      return false;
    }
  };
  useEffect(() => {
    const container = host.current!;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Mô hình 3D cơ thể người. W A S D để di chuyển camera lên, trái, xuống, phải; phím mũi tên để xoay mô hình. E để phóng to, Q để thu nhỏ theo tâm màn hình, R để đặt lại. Kéo để xoay, Shift và kéo để dịch mô hình, cuộn để phóng to theo vị trí chuột, trỏ vào để xem thông tin.");
    container.appendChild(canvas);
    const abort = new AbortController();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motionChanged = () => {
      if (reducedMotion.matches && viewer.current) {
        viewer.current.finish_reconstruction(); animating.current = false; scheduleRender();
        viewer.current.finish_explosion();
        viewer.current.finish_camera_transition(); cameraAnimating.current = false;
        if (!loading.current) setBuilding(false);
      }
    };
    reducedMotion.addEventListener("change", motionChanged);
    let disposed = false;
    let worker: Worker | undefined;
    let cancelPreparation: (() => void) | undefined;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        const ratio = Math.min(window.devicePixelRatio, 2);
        operate(renderer => {
          renderer.resize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
          renderer.reframe(...focusViewport());
        });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const pointers = new Map<number, { x: number; y: number }>();
    let down = { x: 0, y: 0 };
    let dragged = false;
    const withinFocusFrame = (event: MouseEvent) => {
      const bounds = focusFrame.current!.getBoundingClientRect();
      return event.clientX >= bounds.left && event.clientX < bounds.right
        && event.clientY >= bounds.top && event.clientY < bounds.bottom;
    };
    const pointerDown = (event: PointerEvent) => {
      if (loading.current || animating.current || !withinFocusFrame(event)) return;
      canvas.focus({ preventScroll: true });
      clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined;
      canvas.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      if (!pointers.size) { down = point; dragged = false; }
      else dragged = true;
      pointers.set(event.pointerId, point);
    };
    const pick = (event: PointerEvent, read = false) => {
      if (loading.current || animating.current || !withinFocusFrame(event)) return;
      const bounds = canvas.getBoundingClientRect();
      const x = Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width);
      const y = canvas.height - 1 - Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height);
      if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) operate(renderer => {
        const before = renderer.selected_id();
        const id = renderer.pick(x, y);
        setHovered(id);
        if (read) {
          if (id !== before) scheduleRender();
          setReadingId(id); setTargetId(undefined); setFocusedIds([]);
        } else renderer.select(before);
      }, false);
    };
    let hoverTimer = 0;
    let hoverEvent: PointerEvent | undefined;
    const pointerMove = (event: PointerEvent) => {
      if (!withinFocusFrame(event)) {
        pointerCancel(event);
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        pointerLeave();
        return;
      }
      const previous = pointers.get(event.pointerId);
      if (!previous) {
        if (event.pointerType === "mouse" && !event.buttons) {
          hoverEvent = event;
          clearTimeout(hoverTimer);
          hoverTimer = window.setTimeout(() => {
            hoverTimer = 0;
            if (!pointers.size && hoverEvent) pick(hoverEvent);
          }, 100);
        }
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      const dx = point.x - previous.x, dy = point.y - previous.y;
      if (Math.hypot(point.x - down.x, point.y - down.y) > 5) dragged = true;
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(point.x - other.x, point.y - other.y);
        if (before > 1 && after > 1) operate(renderer => renderer.zoom(before / after));
        operate(renderer => renderer.pan(-dx / canvas.clientHeight / 2, dy / canvas.clientHeight / 2));
      } else if (event.button === 2 || (event.buttons & 2) || event.shiftKey) {
        operate(renderer => renderer.pan(-dx / canvas.clientHeight, dy / canvas.clientHeight));
      } else operate(renderer => renderer.rotate(-dx / canvas.clientHeight * Math.PI * 2, dy / canvas.clientHeight * Math.PI * 2));
      pointers.set(event.pointerId, point);
    };
    const pointerUp = (event: PointerEvent) => {
      if (pointers.has(event.pointerId) && pointers.size === 1 && !dragged && event.button !== 2) {
        pick(event, true);
      }
      pointers.delete(event.pointerId);
    };
    const pointerCancel = (event: PointerEvent) => { pointers.delete(event.pointerId); dragged = true; };
    const pointerLeave = () => { clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined; setHovered(""); };
    const wheel = (event: WheelEvent) => {
      if (!withinFocusFrame(event)) return;
      event.preventDefault();
      if (loading.current || animating.current) return;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      const bounds = canvas.getBoundingClientRect();
      operate(renderer => renderer.zoom_at(
        (event.clientX - bounds.left) / bounds.width,
        (event.clientY - bounds.top) / bounds.height,
        Math.exp(Math.max(-1, Math.min(1, pixels * 0.001))),
      ));
    };
    const contextMenu = (event: MouseEvent) => { if (withinFocusFrame(event)) event.preventDefault(); };
    const contextLost = (event: Event) => {
      event.preventDefault(); failed.current = true; animating.current = false; abort.abort(); cancelPreparation?.();
      setError(true); setStatus("Kết nối hiển thị 3D bị mất. Hãy tải lại trang.");
    };
    canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerCancel);
    canvas.addEventListener("lostpointercapture", pointerCancel); canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("contextmenu", contextMenu);
    canvas.addEventListener("webglcontextlost", contextLost);
    (async () => {
      try {
        const wasm = await getWasm();
        if (disposed) return;
        loading.current = true;
        failed.current = false;
        setBuilding(true); setLoadedSystems(0); setMeshes([]); setError(false);
        explosionMode.current = false; reassembling.current = false; setExplosionAmount(0);
        const downloads = roots.map(async root => {
          const model = root.model!;
          const [response, metadataResponse] = await Promise.all([
            fetch(`${import.meta.env.BASE_URL}${model.path}`, { signal: abort.signal }),
            fetch(`${import.meta.env.BASE_URL}${model.path.replace(/\.glb$/, ".json")}`, { signal: abort.signal }),
          ]);
          if (!response.ok || !metadataResponse.ok) throw new Error(`HTTP ${response.status}/${metadataResponse.status}`);
          const metadata = await metadataResponse.json() as { structures: Structure[] };
          if (!Array.isArray(metadata.structures) || !metadata.structures.length
            || !metadata.structures.every(s => s && [s.source_id, s.source_name, s.source_object, s.latin].every(v => typeof v === "string") && s.source_id && s.source_name && ["", "left", "right"].includes(s.laterality) && Array.isArray(s.collections) && s.collections.every(c => typeof c === "string"))
            || new Set(metadata.structures.map(s => s.source_id)).size !== metadata.structures.length) throw new Error("Metadata không hợp lệ");
          if (JSON.stringify(metadata.structures.map(s => s.source_id).sort()) !== JSON.stringify(model.structure_ids.slice().sort())) throw new Error("Metadata không khớp catalog");
          return { bytes: new Uint8Array(await response.arrayBuffer()), metadata };
        }).map(promise => promise.catch(cause => ({ cause })));
        if (disposed) return;
        worker = new Worker(new URL("./model-worker.ts", import.meta.url), { type: "module" });
        const packages: { metadata: { structures: Structure[] } }[] = [];
        const preparedPackages: [Float32Array, Uint32Array, string][] = [];
        for (const download of downloads) {
          const pkg = await download;
          if (disposed) return;
          if (failed.current) throw new Error("Model rendering failed");
          if ("cause" in pkg) throw pkg.cause;
          const prepared = await new Promise<[Float32Array, Uint32Array, string]>((resolve, reject) => {
            cancelPreparation = () => reject(new DOMException("Model loading cancelled", "AbortError"));
            worker!.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.prepared);
            worker!.onerror = event => reject(new Error(event.message));
            worker!.onmessageerror = () => reject(new Error("Cannot transfer prepared geometry"));
            worker!.postMessage({ packages: [pkg.bytes], idsJson: JSON.stringify([pkg.metadata.structures.map(s => s.source_id)]) }, [pkg.bytes.buffer]);
          });
          cancelPreparation = undefined;
          if (disposed) return;
          if (failed.current) throw new Error("Model rendering failed");
          preparedPackages.push(prepared);
          packages.push(pkg);
          setLoadedSystems(packages.length);
          setStatus(`Đang chuẩn bị cơ thể · ${packages.length}/${roots.length} hệ đã nạp`);
        }
        worker.terminate(); worker = undefined;
        // Fit every system before the first frame so reconstruction cannot change the scale.
        const now = performance.now();
        const animate = !reducedMotion.matches;
        for (const prepared of preparedPackages) {
          if (viewer.current) viewer.current.appendPrepared(prepared, now, animate);
          else {
            viewer.current = wasm.AnatomyViewer.fromPrepared(canvas, prepared);
            viewer.current.begin_reconstruction(now, animate);
          }
        }
        resize();
        viewer.current!.configure_explosion(JSON.stringify(roots.map(root => root.model!.structure_ids)));
        if (failed.current) throw new Error("Model rendering failed");
        const structures = [...new Map(packages.flatMap(p => p.metadata.structures).map(part => [part.source_id, part])).values()]
          .sort((a, b) => structureName(a).localeCompare(structureName(b), "vi") || a.source_object.localeCompare(b.source_object));
        setMeshes(structures);
        setVisibleIds(new Set(structures.map(part => part.source_id)));
        loading.current = false;
        animating.current = animate;
        setStatus("Đang hoàn thiện cơ thể…");
        scheduleRender();
        if (!animating.current) setBuilding(false);
      } catch (cause) {
        worker?.terminate(); worker = undefined; cancelPreparation = undefined;
        if (!disposed) {
          abort.abort(); animating.current = false; failed.current = true;
          console.error(cause); setError(true); setStatus("Không nạp được mô hình. Hãy tải lại trang để thử lại.");
        }
      }
    })();
    return () => {
      disposed = true; loading.current = true; animating.current = false; cameraAnimating.current = false; abort.abort(); observer.disconnect(); clearTimeout(hoverTimer);
      reducedMotion.removeEventListener("change", motionChanged);
      cancelPreparation?.(); worker?.terminate(); cancelAnimationFrame(renderFrame.current); renderFrame.current = 0;
      canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel); canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("contextmenu", contextMenu);
      canvas.removeEventListener("webglcontextlost", contextLost);
      viewer.current?.free(); viewer.current = null; canvas.remove();
    };
  }, [catalog]);
  const explosionTarget = () => JSON.stringify(readingId ? [readingId] : focusedIds);
  useEffect(() => {
    if (explosionMode.current) {
      operate(renderer => renderer.set_explode(explosionAmount / 100, performance.now(),
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches, !readingId && !focusedIds.length, explosionTarget()));
    }
  }, [readingId, focusedIds]);
  const changeExplosion = (value: number) => {
    const enabled = value > 0;
    if (!operate(renderer => {
      if (enabled && !explosionMode.current) {
        renderer.set_explode_mode(true);
        explosionMode.current = true;
        renderer.reframe(...focusViewport());
      }
      reassembling.current = !enabled && explosionMode.current;
      if (explosionMode.current) {
        renderer.set_explode(value / 100, performance.now(),
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches, !readingId && !focusedIds.length, explosionTarget());
      }
    })) return;
    setExplosionAmount(value); setHovered("");
  };
  const selectedPart = meshes.find(part => part.source_id === readingId);
  const hoveredPart = meshes.find(part => part.source_id === hovered);
  const referenceName = selectedPart?.source_name ?? target?.source_name;
  const heading = selectedPart ? structureName(selectedPart) : target ? targetName(target) : "Khám phá cơ thể";
  const englishName = selectedPart ? structureName(selectedPart, "en") : target ? targetName(target, "en") : "";
  const changeVisibility = (ids: string[], shown: boolean) => {
    if (!operate(renderer => renderer.change_visibility(JSON.stringify(ids), shown,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? undefined : performance.now()))) return;
    setVisibleIds(current => {
      const next = new Set(current);
      for (const id of ids) { if (shown) next.add(id); else next.delete(id); }
      return next;
    });
  };
  const focusStructures = (ids: string[], focusTarget?: string, revealFolder = false) => {
    const focusedId = !focusTarget && ids.length === 1 ? ids[0]! : "";
    if (!ids.length || !operate(renderer => {
      if (focusTarget && revealFolder) {
        renderer.set_visibility("[]");
        renderer.change_visibility(JSON.stringify(ids), true,
          window.matchMedia("(prefers-reduced-motion: reduce)").matches ? undefined : performance.now());
      } else if (focusTarget || focusedId) renderer.set_visibility(JSON.stringify(ids));
      renderer.focus(JSON.stringify(ids), ...focusViewport());
      renderer.select(focusedId);
    })) return;
    setVisibleIds(current => focusTarget || focusedId ? new Set(ids) : new Set([...current, ...ids]));
    setReaderExpanded(false);
    setHovered("");
    setReadingId(focusedId);
    setTargetId(focusTarget);
    setFocusedIds(ids);
    if (window.matchMedia("(max-width: 900px)").matches) {
      host.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };
  const returnToOverview = () => {
    const ids = meshes.map(part => part.source_id);
    if (!operate(renderer => {
      renderer.clear_center();
      renderer.select("");
      if (explosionMode.current) {
        renderer.set_explode(0, performance.now(), false, false);
        renderer.set_explode_mode(false);
      }
      renderer.set_visibility(JSON.stringify(ids));
      renderer.inspect("reset");
    })) return;
    explosionMode.current = false; reassembling.current = false; cameraAnimating.current = false;
    setReaderExpanded(false); setReadingId(""); setTargetId(undefined); setFocusedIds([]); setHovered("");
    setVisibleIds(new Set(ids)); setExplosionAmount(0);
  };
  return (
    <>
      <MenuBar disabled={building || error} onBack={returnToOverview} helpId={helpId} />
      <ModelControls disabled={building || error} onOperate={operate} helpId={helpId} />
      <aside className="catalog-panel" aria-label="Cây cấu trúc giải phẫu">
        <div className="catalog-heading"><h2>Cấu trúc</h2><span>{catalog.groups.length} hệ</span></div>
        <StructureSearch structures={meshes} disabled={building || error} onSelect={id => {
          focusStructures([id]);
          setReveal({ id });
          host.current?.querySelector("canvas")?.focus({ preventScroll: true });
        }} />
        <div className="tree-actions">
          <button disabled={building || error} onClick={() => changeVisibility(meshes.map(p => p.source_id), true)}>Hiện tất cả</button>
          <button disabled={building || error} onClick={() => changeVisibility(meshes.map(p => p.source_id), false)}>Ẩn tất cả</button>
        </div>
        <div className="catalog-tree">
          <StructureTree catalog={catalog} structures={meshes} visibleIds={visibleIds} selected={selected} targetId={targetId} reveal={reveal} disabled={building || error}
            onVisibility={changeVisibility} onFocus={focusStructures} onSelect={id => { setReadingId(id); setTargetId(undefined); setFocusedIds([]); operate(renderer => renderer.select(id)); }}
            onTarget={id => { setReadingId(""); setTargetId(id); setFocusedIds([]); operate(renderer => renderer.select("")); }} />
        </div>
      </aside>
      <main id="workspace" tabIndex={-1}>
        <section className="model-space" aria-label="Mô hình giải phẫu">
          <div className="model-canvas" ref={host} aria-busy={building && !error} />
          <div className="model-focus-frame" ref={focusFrame}>
            <div className="model-hud">
              {hoveredPart && !building && <p className="model-status">{structureName(hoveredPart)}
                {structureName(hoveredPart, "en") !== structureName(hoveredPart) && <small lang="en">{structureName(hoveredPart, "en")}</small>}
              </p>}
              <p className={`model-status${error ? " model-error" : ""}`} role={error ? "alert" : "status"}>{!error && !building && meshes.length ? `${visibleIds.size}/${meshes.length} cấu trúc đang hiện` : status}</p>
              {building && !error && <progress className="model-progress" aria-label="Các hệ giải phẫu đã nạp" value={loadedSystems} max={roots.length} />}
              <ExplodeControls value={explosionAmount} disabled={building || error} onChange={changeExplosion} />
            </div>
          </div>
        </section>
      </main>
      <aside className={`information-panel${readerExpanded ? " reader-expanded" : ""}`} aria-label="Thông tin bộ phận">
        <header className="information-heading">
          <div>
            <p className="eyebrow">THÔNG TIN GIẢI PHẪU</p>
            <h2>{heading}</h2>
            {englishName && englishName !== heading && <p className="international-name" lang="en">{englishName}</p>}
          </div>
          {referenceName && <button ref={readerToggle} className="reader-expand" aria-expanded={readerExpanded} aria-controls="information-content"
            onClick={() => setReaderExpanded(value => !value)}>
            {readerExpanded ? "Thu nhỏ" : "Mở rộng"}
          </button>}
        </header>
        <div className="information-content" id="information-content">
          <div className="information-details">
            {!selectedPart && target && !target.structure_ids.length && <p>Nhánh này chưa có mô hình 3D được liên kết.</p>}
            {selectedPart ? <>
              {selectedPart.latin && <p className="latin-name" lang="la">{selectedPart.latin}</p>}
              <p className="collection-names">{selectedPart.collections.filter(name => !/^\d:/.test(name)).map(name => anatomyNames(name).vi).join(" · ")}</p>
            </> : !target && <p className="information-overview">Trỏ vào mô hình để xem tên. Nhấn vào bộ phận hoặc chọn tên trong cây cấu trúc để đọc Wikipedia.</p>}
          </div>
          {referenceName && <WikipediaReader key={referenceName} name={referenceName} expanded={readerExpanded} />}
          <details className="model-credit" onToggle={event => {
            if (event.currentTarget.open) event.currentTarget.scrollIntoView({ block: "nearest" });
          }}>
            <summary>Z-Anatomy — CC BY-SA 4.0</summary>
            <div className="model-credit-description">
              <p>Gauthier Kervyn và các tác giả, phát triển từ BodyParts3D. Mô hình và phân nhóm dẫn xuất theo CC BY-SA 4.0.</p>
              <a href={`${import.meta.env.BASE_URL}models/z-anatomy/ATTRIBUTION.md`} target="_blank" rel="noreferrer">Nguồn và giấy phép</a>
            </div>
          </details>
        </div>
      </aside>
    </>
  );
}
