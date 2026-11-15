import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Catalog } from "./catalog/types";
import { StructureTree } from "./structure-tree";
import { StructureSearch } from "./structure-search";
import { useCameraKeys } from "./use-camera-keys";
import { MenuBar } from "./menu-bar";
import { OrientationAxes } from "./orientation-axes";
import type { OrientationAxesHandle } from "./orientation-axes";
import { ExplodeControls } from "./explode-controls";
import { HandCameraControls } from "./hand-camera-controls";
import { CameraDevicesContext, useCameraDevices } from "./camera-devices";
import { WikipediaReader } from "./wikipedia-reader";
import { OpenStaxLink, OpenStaxReading } from "./openstax-reference";
import { useLanguage } from "../i18n";
import { canReadStructure, StudySession } from "./study/session";
import { ViewerRuntime } from "./viewer/runtime";
import { ViewerStatusNotice } from "./viewer-status";
import { desktopPanelQuery, measureViewport } from "./viewer/layout";
import { useGraphicsSettings } from "../pages/use-graphics-settings";
import { SidebarToggle } from "../pages/workspace-layout";
import { WorkspaceActiveContext } from "../pages/module-layout";
import { shortcutAction } from "../shortcuts";
import { loadAnatomyHiddenIds, saveAnatomyHiddenIds } from "./study/storage";

export function ModelViewer({ catalog }: { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const [graphics] = useGraphicsSettings();
  const active = useContext(WorkspaceActiveContext);
  const [fps, setFps] = useState(0);
  const [hold, setHold] = useState<{ x: number; y: number; action: "hide" | "move" } | null>(null);
  const [snapTarget, setSnapTarget] = useState("");
  const [panel, setPanel] = useState<"catalog" | "information" | null>(null);
  const [collapsedPanels, setCollapsedPanels] = useState({ catalog: false, information: false });
  const [desktopPanels, setDesktopPanels] = useState(() => window.matchMedia(desktopPanelQuery).matches);
  const [handCameraEnabled, setHandCameraEnabled] = useState(false);
  const [handCameraActive, setHandCameraActive] = useState(false);
  const sharedCameras = useContext(CameraDevicesContext);
  const localCameras = useCameraDevices(!sharedCameras);
  const cameras = sharedCameras ?? localCameras;
  const catalogId = useId();
  const informationId = useId();
  const menuBar = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<HTMLDivElement>(null);
  const catalogPanel = useRef<HTMLElement>(null);
  const informationPanel = useRef<HTMLElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const orientation = useRef<OrientationAxesHandle>(null);
  const orientationHud = useRef<HTMLDivElement>(null);
  const runtime = useRef<ViewerRuntime | null>(null);
  const session = useMemo(() => new StudySession(catalog), [catalog]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const restoredVisibility = useRef(false);
  const { structureIds, building, error, loadedSystems, selected, readingId, targetId,
    visibleIds, readerExpanded, explosionAmount, movingId, separatedIds, reveal, canGoBack, canGoForward } = state;
  useCameraKeys(!active || building || error, session.control);
  const roots = session.catalog.roots;
  const target = useMemo(() => targetId ? catalog.target(targetId) : undefined, [catalog, targetId]);
  const focusViewport = () => measureViewport({ host: host.current!, frame: focusFrame.current!,
    menu: menuBar.current!, catalog: catalogPanel.current!, information: informationPanel.current!, hud: hud.current! });

  useEffect(() => {
    const media = window.matchMedia(desktopPanelQuery);
    const update = () => setDesktopPanels(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let active = true;
    let hiddenIds: string[] | null = null;
    const viewer = new ViewerRuntime(host.current!, { viewport: focusViewport,
      onState: patch => {
        session.updateViewer(patch);
        if (!restoredVisibility.current && patch.structureIds?.length) {
          restoredVisibility.current = true;
          if (hiddenIds) session.restoreHiddenIds(hiddenIds);
        }
      }, onPick: session.pick, onHide: ids => session.changeVisibility(ids, false), onFps: setFps, onHold: setHold, onSnap: setSnapTarget,
      onOrientation: axes => orientation.current?.update(axes) });
    runtime.current = viewer; session.connect(viewer);
    void loadAnatomyHiddenIds().catch(error => {
      console.error("Could not load Anatomy visibility", error);
      return null;
    }).then(async saved => {
      if (!active) return;
      hiddenIds = saved;
      await viewer.start(catalog);
    });
    return () => { active = false; session.disconnect(viewer); viewer.dispose(); if (runtime.current === viewer) runtime.current = null; };
  }, [session]);
  useEffect(() => {
    if (!restoredVisibility.current) return;
    const hiddenIds = state.structureIds.filter(id => !state.visibleIds.has(id)).sort();
    void saveAnatomyHiddenIds(hiddenIds).catch(error => console.error("Could not save Anatomy visibility", error));
  }, [state.structureIds, state.visibleIds]);
  useEffect(() => {
    runtime.current?.setGraphics(graphics);
  }, [graphics, session]);
  const performAction = useCallback((action: ReturnType<typeof shortcutAction>) => {
    if (!action) return;
    const current = session.getSnapshot();
    if (action === "catalog" || action === "information") {
      if (desktopPanels) setCollapsedPanels(current => ({ ...current, [action]: !current[action] }));
      else setPanel(current => current === action ? null : action);
    }
    else if (!current.building && !current.error) {
      if (action === "back") session.back();
      else if (action === "forward") session.forward();
      else if (action === "restore" && (current.movingId || current.separatedIds.size)) session.restoreStructure("");
    }
  }, [session, desktopPanels]);
  useEffect(() => {
    if (!active) return;
    const keyDown = (event: KeyboardEvent) => {
      const action = shortcutAction(event);
      if (!action || action === "settings") return;
      event.preventDefault();
      performAction(action);
    };
    const frameKeyDown = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "wikipedia:shortcut" || typeof data.key !== "string" || typeof data.code !== "string"
        || typeof data.metaKey !== "boolean" || typeof data.ctrlKey !== "boolean" || typeof data.shiftKey !== "boolean"
        || ![...document.querySelectorAll<HTMLIFrameElement>("iframe.wikipedia-article")].some(frame => frame.contentWindow === event.source)) return;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: data.key, code: data.code, metaKey: data.metaKey, ctrlKey: data.ctrlKey, shiftKey: data.shiftKey, bubbles: true, cancelable: true }));
    };
    document.addEventListener("keydown", keyDown);
    window.addEventListener("message", frameKeyDown);
    return () => { document.removeEventListener("keydown", keyDown); window.removeEventListener("message", frameKeyDown); };
  }, [active, performAction]);
  useEffect(() => {
    const panels = [catalogPanel.current!, informationPanel.current!];
    const centerControls = () => {
      for (const panel of panels) {
        panel.inert = !!panel.hidden || getComputedStyle(panel).pointerEvents === "none";
        panel.ariaHidden = String(panel.inert);
      }
      const viewport = focusViewport();
      if (!building && !error) runtime.current?.centerReader(readerExpanded && !informationPanel.current!.inert && !!informationPanel.current?.getClientRects().length, viewport);
    };
    let frame = 0;
    const animateControls = () => {
      frame = 0;
      centerControls();
      if (panels.some(panel => panel.getAnimations().some(animation => animation.playState === "running"))) frame = requestAnimationFrame(animateControls);
    };
    const startTransition = () => { if (!frame) frame = requestAnimationFrame(animateControls); };
    for (const panel of panels) panel.addEventListener("transitionrun", startTransition);
    const observer = new ResizeObserver(centerControls);
    for (const element of [host.current!, menuBar.current!, catalogPanel.current!, informationPanel.current!]) observer.observe(element);
    centerControls();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const panel of panels) panel.removeEventListener("transitionrun", startTransition);
    };
  }, [session, building, error, readerExpanded ? selected : "", readerExpanded, handCameraEnabled]);

  const focusStructures = useCallback((ids: string[], focusTarget?: string) => {
    if (!session.focus(ids, focusTarget)) return;
    setPanel(null);
  }, [session]);
  const chooseSearchResult = useCallback((id: string) => {
    if (catalog.target(id)) focusStructures([], id);
    else focusStructures([id]);
    session.revealStructure(id);
    host.current?.querySelector("canvas")?.focus({ preventScroll: true });
  }, [catalog, session, focusStructures]);
  const selectedPart = useMemo(() => catalog.detail(readingId), [catalog, readingId, structureIds]);
  const snapPart = useMemo(() => catalog.detail(snapTarget), [catalog, snapTarget, structureIds]);
  const canReadReference = !!selectedPart && canReadStructure(state, readingId);
  const referenceName = canReadReference ? selectedPart.source_name : target?.source_name;
  const openstaxId = selectedPart?.source_id ?? target?.id ?? "";
  const openstaxReference = useMemo(() => catalog.openstaxReference(openstaxId), [catalog, openstaxId, structureIds]);
  const otherLanguage = language === "vi" ? "en" : "vi";
  const heading = selectedPart ? selectedPart.names[language] : target ? target.names[language] : t("information.defaultTitle");
  const otherHeading = selectedPart ? selectedPart.names[otherLanguage] : target ? target.names[otherLanguage] : "";
  const panelToggle = (target: "catalog" | "information", name: string) => {
    const expanded = desktopPanels ? !collapsedPanels[target] : panel === target;
    return <SidebarToggle expanded={expanded} controls={target === "catalog" ? catalogId : informationId}
      name={name} shortcut={target} onToggle={() => performAction(target)} />;
  };
  return (
    <>
      <MenuBar ref={menuBar} disabled={building || error} canGoBack={canGoBack} canGoForward={canGoForward}
        catalogToggle={panelToggle("catalog", t("catalog.heading"))} informationToggle={panelToggle("information", t("information.panel.label"))}
        cameraEnabled={handCameraEnabled} cameraActive={handCameraActive || cameras.accessActive} onCameraChange={setHandCameraEnabled}
        cameraAccessPending={cameras.requesting} onBack={session.back} onForward={session.forward} />
      <aside id={catalogId} ref={catalogPanel} className="catalog-panel" data-open={panel === "catalog"} data-collapsed={collapsedPanels.catalog} aria-label={t("catalog.navigation.label")}>
        <div className="catalog-heading"><h2>{t("catalog.heading")}</h2><span>{t("catalog.systemCount", { count: catalog.groupCount })}</span></div>
        <div className="tree-actions">
          <button disabled={building || error} onClick={() => session.changeVisibility(structureIds, true)}>{t("catalog.showAll")}</button>
          <button disabled={building || error} onClick={() => session.changeVisibility(structureIds, false)}>{t("catalog.hideAll")}</button>
          <StructureSearch catalog={catalog} disabled={building || error} label={t("search.submit")} onSelect={chooseSearchResult} />
        </div>
        <div className="catalog-tree">
          <StructureTree catalog={catalog} visibleIds={visibleIds} selected={selected} targetId={targetId} reveal={reveal} disabled={building || error}
            onVisibility={session.changeVisibility} onFocus={focusStructures} onSelect={session.browseStructure}
            onTarget={session.browseTarget} />
        </div>
      </aside>
      <main id="workspace" tabIndex={-1}>
        <section className="anatomy-space" aria-label={t("viewer.section.label")}>
          <div className="model-canvas" ref={host} aria-busy={building && !error} />
          {hold && <svg key={hold.action} className="model-hold-progress" data-action={hold.action} style={{ left: hold.x, top: hold.y }} viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="16" />
            <circle className="model-hold-fill" cx="20" cy="20" r="16" pathLength="100" />
          </svg>}
          <div className="model-focus-frame" ref={focusFrame}>
            <HandCameraControls enabled={active && handCameraEnabled && !cameras.requesting} disabled={building || error} cameraDisabled={!!movingId || !!separatedIds.size} onControl={session.control}
              deviceId={cameras.deviceId} onCameraStarted={cameras.refresh} onCameraActiveChange={setHandCameraActive}
              sceneHost={host} interactionFrame={focusFrame} obstacles={[hud, catalogPanel, informationPanel, orientationHud]}
              onEnabledChange={setHandCameraEnabled} />
            <div className="model-orientation" ref={orientationHud}>
              <div hidden={!graphics.showAxes}>
                <OrientationAxes ref={orientation} disabled={building || error || !graphics.showAxes} onControl={session.control} />
              </div>
              {graphics.showFps && <span className="model-fps" aria-label={t("graphics.fps.current", { count: fps || "—" })}>{fps || "—"} FPS</span>}
            </div>
            <div ref={hud} className="model-hud">
              {snapPart && <div className="model-status model-snap-hint" role="status">
                {t("viewer.snapHint", { name: snapPart.names[language] })}
              </div>}
              {(movingId || separatedIds.size > 0) && <div className="model-status separation-status" role="status">
                <span>{t("context.dragHint")}</span>
              </div>}
              <ViewerStatusNotice state={state} totalSystems={roots.length} />
              {building && !error && <progress className="model-progress" aria-label={t("viewer.loading.systems")} value={loadedSystems} max={roots.length} />}
              <ExplodeControls value={explosionAmount} disabled={building || error || !!movingId || !!separatedIds.size}
                locked={!!movingId || !!separatedIds.size} onChange={session.changeExplosion} />
            </div>
          </div>
        </section>
      </main>
      <aside id={informationId} ref={informationPanel} className={`information-panel${readerExpanded ? " reader-expanded" : ""}`} data-open={panel === "information"} data-collapsed={collapsedPanels.information} aria-label={t("information.panel.label")}>
        <header className="information-heading" data-structure-id={readingId || undefined}>
          <div className="information-heading-row">
            <h2>{heading}</h2>
            <button className="reader-expand" aria-expanded={readerExpanded} aria-controls="information-content"
              onClick={session.toggleReader}>
              {t(readerExpanded ? "information.collapse" : "information.expand")}
            </button>
          </div>
          {otherHeading && otherHeading !== heading && <p className="international-name" lang={otherLanguage}>{otherHeading}</p>}
        </header>
        <div className="information-content" id="information-content">
          <div className="information-details">
            {!selectedPart && target && !target.count && <p>{t("information.noLinkedModel")}</p>}
            {selectedPart ? <>
              {selectedPart.latin && <p className="latin-name" lang="la">{selectedPart.latin}</p>}
              <p className="collection-names">{selectedPart.collection_names.map(name => name[language]).join(" · ")}</p>
            </> : !target && <p className="information-overview">{t("information.overview")}</p>}
          </div>
          {referenceName ? <WikipediaReader key={referenceName} name={referenceName} expanded={readerExpanded}
            actions={<OpenStaxLink reference={openstaxReference} compact={!readerExpanded} />} />
            : openstaxReference && <div className="reader-actions"><OpenStaxLink reference={openstaxReference} compact={!readerExpanded} /></div>}
          <div className="model-credit">
            <div className="credit-sources">
              <a href={`${import.meta.env.BASE_URL}models/z-anatomy/ATTRIBUTION.md`} target="_blank" rel="noreferrer" aria-label={t("credit.link")} title={t("credit.summary")}>{readerExpanded ? t("credit.summary") : "Z-Anatomy"}</a>
              <OpenStaxReading reference={openstaxReference} compact={!readerExpanded} />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
