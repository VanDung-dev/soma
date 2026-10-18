import { useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import type { Catalog } from "./catalog/types";
import { StructureTree } from "./structure-tree";
import { StructureSearch } from "./structure-search";
import { ModelControls } from "./model-controls";
import { MenuBar } from "./menu-bar";
import { ExplodeControls } from "./explode-controls";
import { WikipediaReader } from "./wikipedia-reader";
import { anatomyNames, structureName, targetName } from "./anatomy-names";
import { useLanguage } from "./i18n";
import { StudySession } from "./study/session";
import { ViewerRuntime } from "./viewer/runtime";
import { measureViewport } from "./viewer/layout";

export function ModelViewer({ catalog }: { catalog: Catalog }) {
  const { language, t } = useLanguage();
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
    visibleIds, readerExpanded, explosionAmount, reveal, canGoBack, canGoForward } = useSyncExternalStore(session.subscribe, session.getSnapshot);
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
    host.current?.querySelector("canvas")?.setAttribute("aria-label", t("viewer.canvas.label"));
  }, [t]);
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
  const otherLanguage = language === "vi" ? "en" : "vi";
  const heading = selectedPart ? structureName(selectedPart, language) : target ? targetName(target, language) : t("information.defaultTitle");
  const otherHeading = selectedPart ? structureName(selectedPart, otherLanguage) : target ? targetName(target, otherLanguage) : "";
  const localizedStatus = error
    ? status.includes("Kết nối hiển thị") ? t("viewer.error.contextLost")
      : status.includes("xử lý mô hình") ? t("viewer.error.process")
        : status.includes("hiển thị mô hình") ? t("viewer.error.render") : t("viewer.error.load")
    : status.startsWith("Đang chuẩn bị cơ thể") ? t("viewer.status.preparing", { loaded: loadedSystems, total: roots.length })
      : status === "Đang nạp mô hình…" ? t("viewer.status.loading")
        : status === "Đang hoàn thiện cơ thể…" ? t("viewer.status.finishing") : status;
  return (
    <>
      <MenuBar disabled={building || error} canGoBack={canGoBack} canGoForward={canGoForward}
        onBack={session.back} onForward={session.forward} helpId={helpId} />
      <ModelControls disabled={building || error} onControl={session.control} helpId={helpId} />
      <aside ref={catalogPanel} className="catalog-panel" aria-label={t("catalog.navigation.label")}>
        <div className="catalog-heading"><h2>{t("catalog.heading")}</h2><span>{t("catalog.systemCount", { count: catalog.groups.length })}</span></div>
        <div className="tree-actions">
          <button disabled={building || error} onClick={() => session.changeVisibility(meshes.map(p => p.source_id), true)}>{t("catalog.showAll")}</button>
          <button disabled={building || error} onClick={() => session.changeVisibility(meshes.map(p => p.source_id), false)}>{t("catalog.hideAll")}</button>
          <StructureSearch structures={meshes} disabled={building || error} onSelect={id => {
            focusStructures([id]);
            session.revealStructure(id);
            host.current?.querySelector("canvas")?.focus({ preventScroll: true });
          }} />
        </div>
        <div className="catalog-tree">
          <StructureTree catalog={catalog} structures={meshes} visibleIds={visibleIds} selected={selected} targetId={targetId} reveal={reveal} disabled={building || error}
            onVisibility={session.changeVisibility} onFocus={focusStructures} onSelect={session.browseStructure}
            onTarget={session.browseTarget} />
        </div>
      </aside>
      <main id="workspace" tabIndex={-1}>
        <section className="model-space" aria-label={t("viewer.section.label")}>
          <div className="model-canvas" ref={host} aria-busy={building && !error} />
          <div className="model-focus-frame" ref={focusFrame}>
            <div ref={hud} className="model-hud">
              {hoveredPart && !building && <p className="model-status">{structureName(hoveredPart, language)}
                {structureName(hoveredPart, otherLanguage) !== structureName(hoveredPart, language) && <small lang={otherLanguage}>{structureName(hoveredPart, otherLanguage)}</small>}
              </p>}
              <p className={`model-status${error ? " model-error" : ""}`} role={error ? "alert" : "status"}>{!error && !building && meshes.length ? t("viewer.status.visibleCount", { visible: visibleIds.size, total: meshes.length }) : localizedStatus}</p>
              {building && !error && <progress className="model-progress" aria-label={t("viewer.loading.systems")} value={loadedSystems} max={roots.length} />}
              <ExplodeControls value={explosionAmount} disabled={building || error} onChange={session.changeExplosion} />
            </div>
          </div>
        </section>
      </main>
      <aside ref={informationPanel} className={`information-panel${readerExpanded ? " reader-expanded" : ""}`} aria-label={t("information.panel.label")}>
        <header className="information-heading">
          <div>
            <p className="eyebrow">{t("information.eyebrow")}</p>
            <h2>{heading}</h2>
            {otherHeading && otherHeading !== heading && <p className="international-name" lang={otherLanguage}>{otherHeading}</p>}
          </div>
          <button ref={readerToggle} className="reader-expand" aria-expanded={readerExpanded} aria-controls="information-content"
            onClick={session.toggleReader}>
            {t(readerExpanded ? "information.collapse" : "information.expand")}
          </button>
        </header>
        <div className="information-content" id="information-content">
          <div className="information-details">
            {!selectedPart && target && !target.structure_ids.length && <p>{t("information.noLinkedModel")}</p>}
            {selectedPart ? <>
              {selectedPart.latin && <p className="latin-name" lang="la">{selectedPart.latin}</p>}
              <p className="collection-names">{selectedPart.collections.filter(name => !/^\d:/.test(name)).map(name => anatomyNames(name)[language]).join(" · ")}</p>
            </> : !target && <p className="information-overview">{t("information.overview")}</p>}
          </div>
          {referenceName && <WikipediaReader key={referenceName} name={referenceName} expanded={readerExpanded} />}
          <details className="model-credit" onToggle={event => {
            if (event.currentTarget.open) event.currentTarget.scrollIntoView({ block: "nearest" });
          }}>
            <summary>{t("credit.summary")}</summary>
            <div className="model-credit-description">
              <p>{t("credit.description")}</p>
              <a href={`${import.meta.env.BASE_URL}models/z-anatomy/ATTRIBUTION.md`} target="_blank" rel="noreferrer">{t("credit.link")}</a>
            </div>
          </details>
        </div>
      </aside>
    </>
  );
}
