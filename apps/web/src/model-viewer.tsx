import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import type { Catalog } from "./catalog/types";
import { StructureTree } from "./structure-tree";
import { StructureSearch } from "./structure-search";
import { ModelControls } from "./model-controls";
import { MenuBar } from "./menu-bar";
import { ExplodeControls } from "./explode-controls";
import { WikipediaReader } from "./wikipedia-reader";
import { anatomyNames, structureName, targetName } from "./anatomy-names";
import { StudySession } from "./study/session";
import { ViewerRuntime } from "./viewer/runtime";
import { measureViewport } from "./viewer/layout";

export function ModelViewer({ catalog }: { catalog: Catalog }) {
  const helpId = useId();
  const host = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<HTMLDivElement>(null);
  const catalogPanel = useRef<HTMLElement>(null);
  const informationPanel = useRef<HTMLElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const readerToggle = useRef<HTMLButtonElement>(null);
  const runtime = useRef<ViewerRuntime | null>(null);
  const session = useMemo(() => new StudySession(catalog), [catalog]);
  const { meshes, building, error, status, loadedSystems, selected, hovered, readingId, targetId,
    visibleIds, readerExpanded, explosionAmount, reveal } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const roots = session.catalog.roots;
  const target = targetId ? session.catalog.targets.get(targetId) : undefined;
  const focusViewport = () => measureViewport({ host: host.current!, frame: focusFrame.current!,
    catalog: catalogPanel.current!, information: informationPanel.current!, hud: hud.current! });

  useEffect(() => {
    const viewer = new ViewerRuntime(host.current!, { viewport: focusViewport,
      frame: () => focusFrame.current!.getBoundingClientRect(), onState: session.updateViewer, onPick: session.pick });
    runtime.current = viewer; session.connect(viewer);
    void viewer.start(roots);
    return () => { session.disconnect(viewer); viewer.dispose(); if (runtime.current === viewer) runtime.current = null; };
  }, [session]);
  useEffect(() => {
    if (!readerExpanded) return;
    const closeReader = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      session.closeReader(); readerToggle.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", closeReader);
    return () => document.removeEventListener("keydown", closeReader);
  }, [session, readerExpanded]);
  useEffect(() => {
    const centerControls = () => {
      focusViewport();
      if (!building && !error) runtime.current?.centerReader(readerExpanded);
    };
    const observer = new ResizeObserver(centerControls);
    for (const element of [host.current!, catalogPanel.current!, informationPanel.current!, hud.current!]) observer.observe(element);
    centerControls();
    return () => observer.disconnect();
  }, [session, building, error, selected, readerExpanded]);

  const focusStructures = (ids: string[], focusTarget?: string) => {
    if (!session.focus(ids, focusTarget)) return;
    if (window.matchMedia("(max-width: 900px)").matches) host.current?.scrollIntoView({ block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const selectedPart = meshes.find(part => part.source_id === readingId);
  const hoveredPart = meshes.find(part => part.source_id === hovered);
  const referenceName = selectedPart?.source_name ?? target?.source_name;
  const heading = selectedPart ? structureName(selectedPart) : target ? targetName(target) : "Khám phá cơ thể";
  const englishName = selectedPart ? structureName(selectedPart, "en") : target ? targetName(target, "en") : "";
  return (
    <>
      <MenuBar disabled={building || error} onBack={session.overview} helpId={helpId} />
      <ModelControls disabled={building || error} onControl={session.control} helpId={helpId} />
      <aside ref={catalogPanel} className="catalog-panel" aria-label="Cây cấu trúc giải phẫu">
        <div className="catalog-heading"><h2>Cấu trúc</h2><span>{catalog.groups.length} hệ</span></div>
        <StructureSearch structures={meshes} disabled={building || error} onSelect={id => {
          focusStructures([id]);
          session.revealStructure(id);
          host.current?.querySelector("canvas")?.focus({ preventScroll: true });
        }} />
        <div className="tree-actions">
          <button disabled={building || error} onClick={() => session.changeVisibility(meshes.map(p => p.source_id), true)}>Hiện tất cả</button>
          <button disabled={building || error} onClick={() => session.changeVisibility(meshes.map(p => p.source_id), false)}>Ẩn tất cả</button>
        </div>
        <div className="catalog-tree">
          <StructureTree catalog={catalog} structures={meshes} visibleIds={visibleIds} selected={selected} targetId={targetId} reveal={reveal} disabled={building || error}
            onVisibility={session.changeVisibility} onFocus={focusStructures} onSelect={session.browseStructure}
            onTarget={session.browseTarget} />
        </div>
      </aside>
      <main id="workspace" tabIndex={-1}>
        <section className="model-space" aria-label="Mô hình giải phẫu">
          <div className="model-canvas" ref={host} aria-busy={building && !error} />
          <div className="model-focus-frame" ref={focusFrame}>
            <div ref={hud} className="model-hud">
              {hoveredPart && !building && <p className="model-status">{structureName(hoveredPart)}
                {structureName(hoveredPart, "en") !== structureName(hoveredPart) && <small lang="en">{structureName(hoveredPart, "en")}</small>}
              </p>}
              <p className={`model-status${error ? " model-error" : ""}`} role={error ? "alert" : "status"}>{!error && !building && meshes.length ? `${visibleIds.size}/${meshes.length} cấu trúc đang hiện` : status}</p>
              {building && !error && <progress className="model-progress" aria-label="Các hệ giải phẫu đã nạp" value={loadedSystems} max={roots.length} />}
              <ExplodeControls value={explosionAmount} disabled={building || error} onChange={session.changeExplosion} />
            </div>
          </div>
        </section>
      </main>
      <aside ref={informationPanel} className={`information-panel${readerExpanded ? " reader-expanded" : ""}`} aria-label="Thông tin bộ phận">
        <header className="information-heading">
          <div>
            <p className="eyebrow">THÔNG TIN GIẢI PHẪU</p>
            <h2>{heading}</h2>
            {englishName && englishName !== heading && <p className="international-name" lang="en">{englishName}</p>}
          </div>
          <button ref={readerToggle} className="reader-expand" aria-expanded={readerExpanded} aria-controls="information-content"
            onClick={session.toggleReader}>
            {readerExpanded ? "Thu nhỏ" : "Mở rộng"}
          </button>
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
