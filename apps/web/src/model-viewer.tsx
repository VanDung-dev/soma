import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { graphicsStorageKey, readGraphicsSettings } from "./viewer/graphics";
import { ContextMenu } from "./context-menu";
import type { AppContext, ContextAction } from "./context-menu";
import { shortcutAction } from "./shortcuts";

export function ModelViewer({ catalog }: { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const [graphics, setGraphics] = useState(readGraphicsSettings);
  const [fps, setFps] = useState(0);
  const helpId = useId();
  const settingsId = useId();
  const findId = useId();
  const host = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<HTMLDivElement>(null);
  const catalogPanel = useRef<HTMLElement>(null);
  const informationPanel = useRef<HTMLElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const runtime = useRef<ViewerRuntime | null>(null);
  const session = useMemo(() => new StudySession(catalog), [catalog]);
  const { meshes, building, error, status, loadedSystems, selected, readingId, targetId,
    visibleIds, readerExpanded, explosionAmount, movingId, separatedIds, reveal, canGoBack, canGoForward } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const roots = session.catalog.roots;
  const target = targetId ? session.catalog.targets.get(targetId) : undefined;
  const focusViewport = () => measureViewport({ host: host.current!, frame: focusFrame.current!,
    catalog: catalogPanel.current!, information: informationPanel.current!, hud: hud.current! });

  useEffect(() => {
    const viewer = new ViewerRuntime(host.current!, { viewport: focusViewport,
      frame: () => focusFrame.current!.getBoundingClientRect(), onState: session.updateViewer, onPick: session.pick, onFps: setFps });
    runtime.current = viewer; session.connect(viewer);
    viewer.setGraphics(graphics);
    void viewer.start(roots);
    return () => { session.disconnect(viewer); viewer.dispose(); if (runtime.current === viewer) runtime.current = null; };
  }, [session]);
  useEffect(() => {
    runtime.current?.setGraphics(graphics);
    try { window.localStorage.setItem(graphicsStorageKey, JSON.stringify(graphics)); } catch {}
  }, [graphics, session]);
  useEffect(() => {
    host.current?.querySelector("canvas")?.setAttribute("aria-label", t("viewer.canvas.label"));
  }, [t]);
  useEffect(() => {
    const open = (id: string, toggle = true) => {
      const panel = document.getElementById(id);
      if (!panel) return;
      const trigger = document.querySelector<HTMLButtonElement>(`button[popovertarget="${id}"]`);
      if (toggle && panel.matches(":popover-open")) { panel.hidePopover(); trigger?.focus({ preventScroll: true }); return; }
      document.querySelector<HTMLElement>(".context-menu:popover-open")?.hidePopover();
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
          document.querySelector<HTMLElement>(".context-menu:popover-open")?.hidePopover();
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
      focusViewport();
      if (!building && !error) runtime.current?.centerReader(readerExpanded);
    };
    const observer = new ResizeObserver(centerControls);
    for (const element of [host.current!, catalogPanel.current!, informationPanel.current!]) observer.observe(element);
    centerControls();
    return () => observer.disconnect();
  }, [session, building, error, readerExpanded ? selected : "", readerExpanded]);

  const focusStructures = (ids: string[], focusTarget?: string) => {
    if (!session.focus(ids, focusTarget)) return;
    if (window.matchMedia("(max-width: 900px)").matches) host.current?.scrollIntoView({ block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const selectedPart = meshes.find(part => part.source_id === readingId);
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
      <ContextMenu resolve={(element, x, y, keyboard): AppContext => {
        const canvas = element.closest("canvas");
        const id = canvas ? keyboard ? selected : runtime.current?.hitTest(x, y) ?? ""
          : element.closest<HTMLElement>("[data-structure-id]")?.dataset.structureId ?? "";
        const part = meshes.find(part => part.source_id === id);
        const actions: ContextAction[] = [];
        if (part && id === selected && !building && !error) {
          const detached = movingId === id || separatedIds.has(id);
          if (!detached) actions.push({ id: "move", label: "context.detach", disabled: !!explosionAmount || !visibleIds.has(id),
            hint: explosionAmount ? "context.explosionFirst" : undefined, run: () => { session.setMoving(id); } });
          actions.push({ id: "visibility", label: visibleIds.has(id) ? "context.hide" : "context.show", run: () => { session.changeVisibility([id], !visibleIds.has(id)); } });
          if (detached) actions.push({ id: "restore", label: "context.restore", shortcut: "restore", run: () => { session.restoreStructure(id); } });
        }
        const folderId = element.closest<HTMLElement>("[data-target-id]")?.dataset.targetId;
        const folder = folderId ? session.catalog.targets.get(folderId) : undefined;
        const secondaryName = canvas && part && structureName(part, otherLanguage) !== structureName(part, language)
          ? structureName(part, otherLanguage) : undefined;
        return { name: part ? structureName(part, language) : folder ? targetName(folder, language) : undefined,
          secondaryName, showClipboard: !(canvas && part),
          actions };
      }} />
      <MenuBar disabled={building || error} canGoBack={canGoBack} canGoForward={canGoForward}
        onBack={session.back} onForward={session.forward} helpId={helpId} settingsId={settingsId} graphics={graphics} onGraphicsChange={setGraphics} />
      <ModelControls disabled={building || error} onControl={session.control} helpId={helpId} />
      <aside ref={catalogPanel} className="catalog-panel" aria-label={t("catalog.navigation.label")}>
        <div className="catalog-heading"><h2>{t("catalog.heading")}</h2><span>{t("catalog.systemCount", { count: catalog.groups.length })}</span></div>
        <div className="tree-actions">
          <button disabled={building || error} onClick={() => session.changeVisibility(meshes.map(p => p.source_id), true)}>{t("catalog.showAll")}</button>
          <button disabled={building || error} onClick={() => session.changeVisibility(meshes.map(p => p.source_id), false)}>{t("catalog.hideAll")}</button>
          <StructureSearch triggerId={findId} structures={meshes} disabled={building || error} onSelect={id => {
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
            {graphics.showFps && <span className="model-fps" aria-label={t("graphics.fps.current", { count: fps })}>{fps} FPS</span>}
            <div ref={hud} className="model-hud">
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
      <aside ref={informationPanel} className={`information-panel${readerExpanded ? " reader-expanded" : ""}`} aria-label={t("information.panel.label")}>
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
