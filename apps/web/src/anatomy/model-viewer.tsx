import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Catalog } from "./catalog/types";
import { StructureTree } from "./structure-tree";
import { StructureSearch } from "./structure-search";
import { ModelControls } from "./model-controls";
import { AnatomyOnboarding } from "./onboarding";
import { MenuBar } from "./menu-bar";
import { OrientationAxes } from "./orientation-axes";
import type { OrientationAxesHandle } from "./orientation-axes";
import { ExplodeControls } from "./explode-controls";
import { HandCameraControls } from "./hand-camera-controls";
import { useCameraDevices } from "./camera-devices";
import { ReferenceNotice, WikipediaReader } from "./wikipedia-reader";
import { OpenStaxLink, OpenStaxReading } from "./openstax-reference";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import type { MessageKey } from "../i18n";
import { canReadStructure, StudySession } from "./study/session";
import type { ViewerStatus } from "./viewer/contracts";
import { ViewerRuntime } from "./viewer/runtime";
import { measureViewport } from "./viewer/layout";
import { graphicsStorageKey, readGraphicsSettings } from "./viewer/graphics";
import { shortcutAction, shortcutLabel } from "../shortcuts";

const statusMessages = {
  loading: "viewer.status.loading", preparing: "viewer.status.preparing", finishing: "viewer.status.finishing",
  loadError: "viewer.error.load", processError: "viewer.error.process", renderError: "viewer.error.render", contextLost: "viewer.error.contextLost",
} satisfies Record<ViewerStatus, MessageKey>;

export function ModelViewer({ catalog }: { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const [graphics, setGraphics] = useState(readGraphicsSettings);
  const [fps, setFps] = useState(0);
  const [hold, setHold] = useState<{ x: number; y: number } | null>(null);
  const [snapTarget, setSnapTarget] = useState("");
  const [panel, setPanel] = useState<"catalog" | "information" | null>(null);
  const [collapsedPanels, setCollapsedPanels] = useState({ catalog: false, information: false });
  const showPanel = useCallback((panel: "catalog" | "information" | null) => {
    setPanel(panel);
    if (panel) setCollapsedPanels(current => ({ ...current, [panel]: false }));
  }, []);
  const [onboardingRun, setOnboardingRun] = useState(0);
  const [handCameraEnabled, setHandCameraEnabled] = useState(false);
  const [handCameraActive, setHandCameraActive] = useState(false);
  const cameras = useCameraDevices();
  const helpId = useId();
  const settingsId = useId();
  const catalogId = useId();
  const informationId = useId();
  const menuBar = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<HTMLDivElement>(null);
  const catalogPanel = useRef<HTMLElement>(null);
  const informationPanel = useRef<HTMLElement>(null);
  const panelToggles = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const orientation = useRef<OrientationAxesHandle>(null);
  const orientationHud = useRef<HTMLDivElement>(null);
  const runtime = useRef<ViewerRuntime | null>(null);
  const session = useMemo(() => new StudySession(catalog), [catalog]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { structureIds, building, error, status, loadedSystems, selected, readingId, targetId,
    visibleIds, readerExpanded, explosionAmount, movingId, separatedIds, reveal, canGoBack, canGoForward } = state;
  const roots = session.catalog.roots;
  const target = useMemo(() => targetId ? catalog.target(targetId) : undefined, [catalog, targetId]);
  const focusViewport = () => measureViewport({ host: host.current!, frame: focusFrame.current!,
    menu: menuBar.current!, catalog: catalogPanel.current!, information: informationPanel.current!, controls: panelToggles.current!, hud: hud.current! });

  useEffect(() => {
    const viewer = new ViewerRuntime(host.current!, { viewport: focusViewport,
      onState: session.updateViewer, onPick: session.pick, onFps: setFps, onHold: setHold, onSnap: setSnapTarget,
      onOrientation: axes => orientation.current?.update(axes) });
    runtime.current = viewer; session.connect(viewer);
    void viewer.start(catalog);
    return () => { session.disconnect(viewer); viewer.dispose(); if (runtime.current === viewer) runtime.current = null; };
  }, [session]);
  useEffect(() => {
    runtime.current?.setGraphics(graphics);
    try { window.localStorage.setItem(graphicsStorageKey, JSON.stringify(graphics)); } catch {}
  }, [graphics, session]);
  const performAction = useCallback((action: ReturnType<typeof shortcutAction>) => {
    if (!action) return;
    const open = (id: string) => {
      const panel = document.getElementById(id);
      if (!panel) return;
      const trigger = document.querySelector<HTMLButtonElement>(`button[popovertarget="${id}"]`);
      if (panel.matches(":popover-open")) { panel.hidePopover(); trigger?.focus({ preventScroll: true }); return; }
      panel.showPopover();
      panel.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")?.focus({ preventScroll: true });
    };
    const current = session.getSnapshot();
    if (action === "settings") open(settingsId);
    else if (action === "guide") open(helpId);
    else if (action === "catalog" || action === "information") {
      if (window.matchMedia("(min-width: 1141px)").matches) setCollapsedPanels(current => ({ ...current, [action]: !current[action] }));
      else setPanel(current => current === action ? null : action);
    }
    else if (!current.building && !current.error) {
      if (action === "back") session.back();
      else if (action === "forward") session.forward();
      else if (action === "restore" && (current.movingId || current.separatedIds.size)) session.restoreStructure("");
    }
  }, [session, helpId, settingsId]);
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const action = shortcutAction(event);
      if (!action) return;
      if (action === "settings" && document.querySelector(":popover-open:not([data-hand-visual])") && !document.getElementById(settingsId)?.matches(":popover-open")) return;
      event.preventDefault();
      performAction(action);
    };
    const frameKeyDown = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "wikipedia:shortcut" || typeof data.key !== "string" || typeof data.code !== "string"
        || typeof data.metaKey !== "boolean" || typeof data.ctrlKey !== "boolean" || typeof data.shiftKey !== "boolean"
        || ![...document.querySelectorAll<HTMLIFrameElement>("iframe.wikipedia-article")].some(frame => frame.contentWindow === event.source)) return;
      keyDown(new KeyboardEvent("keydown", { key: data.key, code: data.code, metaKey: data.metaKey, ctrlKey: data.ctrlKey, shiftKey: data.shiftKey, cancelable: true }));
    };
    document.addEventListener("keydown", keyDown);
    window.addEventListener("message", frameKeyDown);
    return () => { document.removeEventListener("keydown", keyDown); window.removeEventListener("message", frameKeyDown); };
  }, [performAction, settingsId]);
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
    for (const element of [host.current!, menuBar.current!, catalogPanel.current!, informationPanel.current!, panelToggles.current!]) observer.observe(element);
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
  const localizedStatus = t(statusMessages[status], { loaded: loadedSystems, total: roots.length });
  const panelToggle = (panel: "catalog" | "information", name: string) => <button type="button" className="controls-info sidebar-toggle"
    aria-expanded={!collapsedPanels[panel]} aria-controls={panel === "catalog" ? catalogId : informationId}
    aria-label={t(collapsedPanels[panel] ? "panels.show" : "panels.hide", { name })}
    title={`${t(collapsedPanels[panel] ? "panels.show" : "panels.hide", { name })} (${shortcutLabel(panel)})`}
    onClick={() => setCollapsedPanels(current => ({ ...current, [panel]: !current[panel] }))}>
    <LineIcon name="sidebar" size={18} />
  </button>;
  return (
    <>
      <MenuBar ref={menuBar} disabled={building || error} canGoBack={canGoBack} canGoForward={canGoForward}
        catalogToggle={panelToggle("catalog", t("catalog.heading"))} informationToggle={panelToggle("information", t("information.panel.label"))}
        cameraEnabled={handCameraEnabled} cameraActive={handCameraActive || cameras.accessActive} onCameraChange={setHandCameraEnabled}
        cameraDevices={cameras.devices} cameraDeviceId={cameras.deviceId} cameraDevicesError={cameras.error} onCameraDeviceChange={cameras.setDeviceId}
        cameraAccessPending={cameras.requesting} onCameraAccessRequest={cameras.requestAccess}
        onBack={session.back} onForward={session.forward} helpId={helpId} settingsId={settingsId} graphics={graphics} onGraphicsChange={setGraphics} />
      <ModelControls disabled={building || error} onControl={session.control} helpId={helpId}
        onReplayGuide={() => { document.getElementById(helpId)?.hidePopover(); setHandCameraEnabled(false); setOnboardingRun(run => run + 1); }} />
      <div ref={panelToggles} className="anatomy-panel-toggles">
        <button aria-expanded={panel === "catalog"} aria-controls={catalogId} onClick={() => setPanel(panel === "catalog" ? null : "catalog")}>{t("catalog.heading")}</button>
        <button aria-expanded={panel === "information"} aria-controls={informationId} onClick={() => setPanel(panel === "information" ? null : "information")}>{t("information.panel.label")}</button>
      </div>
      <aside id={catalogId} ref={catalogPanel} className="catalog-panel" data-open={panel === "catalog"} data-collapsed={collapsedPanels.catalog} aria-label={t("catalog.navigation.label")}>
        <div className="catalog-heading"><h2>{t("catalog.heading")}</h2><span>{t("catalog.systemCount", { count: catalog.groupCount })}</span></div>
        <div className="tree-actions">
          <button disabled={building || error} onClick={() => session.changeVisibility(structureIds, true)}>{t("catalog.showAll")}</button>
          <button disabled={building || error} onClick={() => session.changeVisibility(structureIds, false)}>{t("catalog.hideAll")}</button>
          <StructureSearch catalog={catalog} disabled={building || error} onSelect={chooseSearchResult} />
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
          {hold && <svg className="model-hold-progress" style={{ left: hold.x, top: hold.y }} viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="16" />
            <circle className="model-hold-fill" cx="20" cy="20" r="16" pathLength="100" />
          </svg>}
          <div className="model-focus-frame" ref={focusFrame}>
            <HandCameraControls enabled={handCameraEnabled} disabled={building || error} cameraDisabled={!!movingId || !!separatedIds.size} onControl={session.control}
              deviceId={cameras.deviceId} onCameraStarted={cameras.refresh} onCameraActiveChange={setHandCameraActive}
              sceneHost={host} interactionFrame={focusFrame} obstacles={[hud, catalogPanel, informationPanel, panelToggles, orientationHud]}
              onEnabledChange={setHandCameraEnabled} />
            <div className="model-orientation" ref={orientationHud}>
              <div hidden={!graphics.showAxes}>
                <OrientationAxes ref={orientation} disabled={building || error || !graphics.showAxes} onControl={session.control} />
              </div>
              {graphics.showFps && <span className="model-fps" aria-label={t("graphics.fps.current", { count: fps })}>{fps} FPS</span>}
            </div>
            <div ref={hud} className="model-hud">
              {snapPart && <div className="model-status model-snap-hint" role="status">
                {t("viewer.snapHint", { name: snapPart.names[language] })}
              </div>}
              {(movingId || separatedIds.size > 0) && <div className="model-status separation-status" role="status">
                <span>{t("context.dragHint")}</span>
              </div>}
              <p className={`model-status${error ? " model-error" : ""}`} role={error ? "alert" : "status"}>{!error && !building && structureIds.length ? t("viewer.status.visibleCount", { visible: visibleIds.size, total: structureIds.length }) : localizedStatus}</p>
              {building && !error && <progress className="model-progress" aria-label={t("viewer.loading.systems")} value={loadedSystems} max={roots.length} />}
              <ExplodeControls value={explosionAmount} disabled={building || error || !!movingId || !!separatedIds.size}
                locked={!!movingId || !!separatedIds.size} onChange={session.changeExplosion} />
            </div>
          </div>
        </section>
      </main>
      <aside id={informationId} ref={informationPanel} className={`information-panel${readerExpanded ? " reader-expanded" : ""}`} data-open={panel === "information"} data-collapsed={collapsedPanels.information} aria-label={t("information.panel.label")}>
        <header className="information-heading" data-structure-id={readingId || undefined}>
          <div>
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
            {referenceName && <ReferenceNotice compact={!readerExpanded} />}
            <div className="credit-sources">
              <a href={`${import.meta.env.BASE_URL}models/z-anatomy/ATTRIBUTION.md`} target="_blank" rel="noreferrer" aria-label={t("credit.link")} title={t("credit.summary")}>{readerExpanded ? t("credit.summary") : "Z-Anatomy"}</a>
              <OpenStaxReading reference={openstaxReference} compact={!readerExpanded} />
            </div>
          </div>
        </div>
      </aside>
      {!building && !error && !handCameraEnabled && <AnatomyOnboarding key={onboardingRun} replay={onboardingRun > 0} onPanelChange={showPanel} />}
    </>
  );
}
