import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Catalog } from "./catalog/types";
import { StructureTree } from "./structure-tree";
import { StructureSearch } from "./structure-search";
import { ModelControls } from "./model-controls";
import { AnatomyOnboarding } from "./onboarding";
import { MenuBar } from "./menu-bar";
import { ExplodeControls } from "./explode-controls";
import { WikipediaReader } from "./wikipedia-reader";
import { anatomyNames, structureName, targetName } from "./anatomy-names";
import { useLanguage } from "../i18n";
import { StudySession } from "./study/session";
import { ViewerRuntime } from "./viewer/runtime";
import { measureViewport } from "./viewer/layout";
import { graphicsStorageKey, readGraphicsSettings } from "./viewer/graphics";
import { shortcutAction } from "../shortcuts";

export function ModelViewer({ catalog }: { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const [graphics, setGraphics] = useState(readGraphicsSettings);
  const [fps, setFps] = useState(0);
  const [hold, setHold] = useState<{ x: number; y: number } | null>(null);
  const [snapTarget, setSnapTarget] = useState("");
  const [panel, setPanel] = useState<"catalog" | "information" | null>(null);
  const [onboardingRun, setOnboardingRun] = useState(0);
  const helpId = useId();
  const settingsId = useId();
  const findId = useId();
  const catalogId = useId();
  const informationId = useId();
  const host = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<HTMLDivElement>(null);
  const catalogPanel = useRef<HTMLElement>(null);
  const informationPanel = useRef<HTMLElement>(null);
  const panelToggles = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const runtime = useRef<ViewerRuntime | null>(null);
  const session = useMemo(() => new StudySession(catalog), [catalog]);
  const { meshes, building, error, status, loadedSystems, selected, readingId, targetId,
    visibleIds, readerExpanded, explosionAmount, movingId, separatedIds, reveal, canGoBack, canGoForward } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const roots = session.catalog.roots;
  const target = targetId ? session.catalog.targets.get(targetId) : undefined;
  const focusViewport = () => measureViewport({ host: host.current!, frame: focusFrame.current!,
    catalog: catalogPanel.current!, information: informationPanel.current!, controls: panelToggles.current!, hud: hud.current! });

  useEffect(() => {
    const viewer = new ViewerRuntime(host.current!, { viewport: focusViewport,
      onState: session.updateViewer, onPick: session.pick, onFps: setFps, onHold: setHold, onSnap: setSnapTarget });
    runtime.current = viewer; session.connect(viewer);
    void viewer.start(roots);
    return () => { session.disconnect(viewer); viewer.dispose(); if (runtime.current === viewer) runtime.current = null; };
  }, [session]);
  useEffect(() => {
    runtime.current?.setGraphics(graphics);
    try { window.localStorage.setItem(graphicsStorageKey, JSON.stringify(graphics)); } catch {}
  }, [graphics, session]);
  useEffect(() => {
    const open = (id: string, toggle = true) => {
      const panel = document.getElementById(id);
      if (!panel) return;
      const trigger = document.querySelector<HTMLButtonElement>(`button[popovertarget="${id}"]`);
      if (toggle && panel.matches(":popover-open")) { panel.hidePopover(); trigger?.focus({ preventScroll: true }); return; }
      panel.showPopover();
      panel.querySelector<HTMLElement>("input[type='search'], button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus({ preventScroll: true });
    };
    const keyDown = (event: KeyboardEvent) => {
      const action = shortcutAction(event);
      if (!action) return;
      if (action === "settings" && document.querySelector(":popover-open") && !document.getElementById(settingsId)?.matches(":popover-open")) return;
      event.preventDefault();
      const state = session.getSnapshot();
      if (action === "settings") open(settingsId);
      else if (action === "guide") open(helpId);
      else if (!state.building && !state.error) {
        if (action === "back") session.back();
        else if (action === "forward") session.forward();
        else if (action === "find") {
          const id = document.getElementById(findId)?.getAttribute("popovertarget");
          if (id) open(id, false);
        } else if (action === "restore") {
          if (state.movingId || state.separatedIds.size) session.restoreStructure("");
        }
      }
    };
    const frameKeyDown = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "wikipedia:shortcut" || typeof data.key !== "string" || typeof data.code !== "string"
        || typeof data.metaKey !== "boolean" || typeof data.ctrlKey !== "boolean"
        || ![...document.querySelectorAll<HTMLIFrameElement>("iframe.wikipedia-article")].some(frame => frame.contentWindow === event.source)) return;
      keyDown(new KeyboardEvent("keydown", { key: data.key, code: data.code, metaKey: data.metaKey, ctrlKey: data.ctrlKey, cancelable: true }));
    };
    document.addEventListener("keydown", keyDown);
    window.addEventListener("message", frameKeyDown);
    return () => { document.removeEventListener("keydown", keyDown); window.removeEventListener("message", frameKeyDown); };
  }, [session, helpId, settingsId, findId]);
  useEffect(() => {
    const centerControls = () => {
      const viewport = focusViewport();
      if (!building && !error) runtime.current?.centerReader(readerExpanded, viewport);
    };
    const observer = new ResizeObserver(centerControls);
    for (const element of [host.current!, catalogPanel.current!, informationPanel.current!, panelToggles.current!]) observer.observe(element);
    centerControls();
    return () => observer.disconnect();
  }, [session, building, error, readerExpanded ? selected : "", readerExpanded]);

  const focusStructures = useCallback((ids: string[], focusTarget?: string) => {
    if (!session.focus(ids, focusTarget)) return;
    setPanel(null);
  }, [session]);
  const chooseStructure = useCallback((id: string) => {
    focusStructures([id]);
    session.revealStructure(id);
    host.current?.querySelector("canvas")?.focus({ preventScroll: true });
  }, [session, focusStructures]);
  const structures = useMemo(() => new Map(meshes.map(part => [part.source_id, part])), [meshes]);
  const selectedPart = structures.get(readingId);
  const snapPart = structures.get(snapTarget);
  const canReadReference = !!selectedPart && (movingId === readingId || separatedIds.has(readingId));
  const referenceName = canReadReference ? selectedPart.source_name : target?.source_name;
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
        onBack={session.back} onForward={session.forward} helpId={helpId} settingsId={settingsId} graphics={graphics} onGraphicsChange={setGraphics} />
      <ModelControls disabled={building || error} onControl={session.control} helpId={helpId}
        onReplayGuide={() => { document.getElementById(helpId)?.hidePopover(); setOnboardingRun(run => run + 1); }} />
      <div ref={panelToggles} className="anatomy-panel-toggles">
        <button aria-expanded={panel === "catalog"} aria-controls={catalogId} onClick={() => setPanel(panel === "catalog" ? null : "catalog")}>{t("catalog.heading")}</button>
        <button aria-expanded={panel === "information"} aria-controls={informationId} onClick={() => setPanel(panel === "information" ? null : "information")}>{t("information.panel.label")}</button>
      </div>
      <aside id={catalogId} ref={catalogPanel} className="catalog-panel" data-open={panel === "catalog"} aria-label={t("catalog.navigation.label")}>
        <div className="catalog-heading"><h2>{t("catalog.heading")}</h2><span>{t("catalog.systemCount", { count: catalog.groups.length })}</span></div>
        <div className="tree-actions">
          <button disabled={building || error} onClick={() => session.changeVisibility(meshes.map(p => p.source_id), true)}>{t("catalog.showAll")}</button>
          <button disabled={building || error} onClick={() => session.changeVisibility(meshes.map(p => p.source_id), false)}>{t("catalog.hideAll")}</button>
          <StructureSearch triggerId={findId} structures={meshes} disabled={building || error} onSelect={chooseStructure} />
        </div>
        <div className="catalog-tree">
          <StructureTree catalog={catalog} structures={meshes} visibleIds={visibleIds} selected={selected} targetId={targetId} reveal={reveal} disabled={building || error}
            onVisibility={session.changeVisibility} onFocus={focusStructures} onSelect={session.browseStructure}
            onTarget={session.browseTarget} />
        </div>
      </aside>
      <main id="workspace" tabIndex={-1}>
        <section className="anatomy-space" aria-label={t("viewer.section.label")}>
          <div className="model-canvas" ref={host} aria-busy={building && !error} />
          {hold && <svg className="model-hold-progress" style={{ left: hold.x, top: hold.y }} viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="16" />
            <circle className="model-hold-fill" cx="20" cy="20" r="16" pathLength="100" />
          </svg>}
          <div className="model-focus-frame" ref={focusFrame}>
            {graphics.showFps && <span className="model-fps" aria-label={t("graphics.fps.current", { count: fps })}>{fps} FPS</span>}
            <div ref={hud} className="model-hud">
              {snapPart && <div className="model-status model-snap-hint" role="status">
                {t("viewer.snapHint", { name: structureName(snapPart, language) })}
              </div>}
              {(movingId || separatedIds.size > 0) && <div className="model-status separation-status" role="status">
                <span>{t("context.dragHint")}</span>
              </div>}
              <p className={`model-status${error ? " model-error" : ""}`} role={error ? "alert" : "status"}>{!error && !building && meshes.length ? t("viewer.status.visibleCount", { visible: visibleIds.size, total: meshes.length }) : localizedStatus}</p>
              {building && !error && <progress className="model-progress" aria-label={t("viewer.loading.systems")} value={loadedSystems} max={roots.length} />}
              <ExplodeControls value={explosionAmount} disabled={building || error || !!movingId || !!separatedIds.size}
                locked={!!movingId || !!separatedIds.size} onChange={session.changeExplosion} />
            </div>
          </div>
        </section>
      </main>
      <aside id={informationId} ref={informationPanel} className={`information-panel${readerExpanded ? " reader-expanded" : ""}`} data-open={panel === "information"} aria-label={t("information.panel.label")}>
        <header className="information-heading" data-structure-id={readingId || undefined}>
          <div>
            <p className="eyebrow">{t("information.eyebrow")}</p>
            <h2>{heading}</h2>
            {otherHeading && otherHeading !== heading && <p className="international-name" lang={otherLanguage}>{otherHeading}</p>}
          </div>
          <button className="reader-expand" aria-expanded={readerExpanded} aria-controls="information-content"
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
          <div className="model-credit">
            <a href={`${import.meta.env.BASE_URL}models/z-anatomy/ATTRIBUTION.md`} target="_blank" rel="noreferrer" aria-label={t("credit.link")}>{t("credit.summary")}</a>
          </div>
        </div>
      </aside>
      {!building && !error && <AnatomyOnboarding key={onboardingRun} replay={onboardingRun > 0} onPanelChange={setPanel} />}
    </>
  );
}
