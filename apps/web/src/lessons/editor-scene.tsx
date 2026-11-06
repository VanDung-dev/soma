import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getCatalog } from "../anatomy/core";
import type { Catalog } from "../anatomy/catalog/types";
import { OrientationAxes } from "../anatomy/orientation-axes";
import { ViewerStatusNotice } from "../anatomy/viewer-status";
import { StructureTree } from "../anatomy/structure-tree";
import { ExplodeControls } from "../anatomy/explode-controls";
import { PopoverPanel } from "../popover-panel";
import { useLanguage } from "../i18n";
import { useLessonViewer } from "./viewer";
import { LessonStructureTools } from "./structure-tools";
import type { SceneView } from "../anatomy/viewer/contracts";

type SceneProps = {
  modelId: string; targetId: string; sectionId: string; frame: HTMLElement; controls: HTMLElement; inactive: boolean;
  visibleIds?: string[]; onChangeScene: (ids: string[]) => void;
  view?: SceneView; canSave: boolean; onSaveView: (view: SceneView, ids: string[]) => void;
};

export function EditorScene(props: SceneProps) {
  const { t } = useLanguage();
  const [catalog, setCatalog] = useState<Catalog>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let owned: Catalog | undefined;
    getCatalog().then(value => {
      if (!active) { value.free(); return; }
      owned = value;
      setCatalog(value);
    }, error => {
      if (active) { console.error("Lesson scene catalog failed", error); setFailed(true); }
    });
    return () => { active = false; owned?.free(); };
  }, []);

  if (catalog) return <Scene catalog={catalog} {...props} />;
  return createPortal(
    <p className={`lesson-model-message model-status${failed ? " model-error" : ""}`} role={failed ? "alert" : "status"}>
      {t(failed ? "lessons.targetError" : "viewer.status.loading")}
    </p>, props.frame);
}

function Scene({ catalog, modelId, targetId, sectionId, frame, controls, inactive, visibleIds, view, canSave, onSaveView, onChangeScene }: SceneProps & { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const ids = useMemo(() => visibleIds ?? catalog.members(targetId), [catalog, targetId, visibleIds]);
  const { host, orientation, showAxes, session, state, hold, snapTarget } = useLessonViewer(catalog, modelId, undefined, frame,
    hiddenIds => {
      const hidden = new Set(hiddenIds);
      onChangeScene(ids.filter(id => !hidden.has(id)));
    });
  const ready = !state.building && !state.error;
  const shown = useMemo(() => new Set(ids), [ids]);
  const reveal = useMemo(() => ({ id: targetId }), [targetId]);
  const snapPart = useMemo(() => catalog.detail(snapTarget), [catalog, snapTarget, state.structureIds]);
  const separated = !!state.movingId || !!state.separatedIds.size;
  useEffect(() => {
    if (ready) session.applyScene(ids, view);
  }, [ready, session, sectionId, ids, view]);

  return createPortal(<div className="lesson-editor-scene" inert={inactive} aria-label={t("viewer.section.label")} role="group">
    <div className="model-canvas" ref={host} aria-busy={state.building && !state.error} />
    {hold && <svg key={hold.action} className="model-hold-progress" data-action={hold.action} style={{ left: hold.x, top: hold.y }} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="16" />
      <circle className="model-hold-fill" cx="20" cy="20" r="16" pathLength="100" />
    </svg>}
    {createPortal(<div className="lesson-editor-hud">
      <ExplodeControls value={state.explosionAmount} disabled={!ready || separated} locked={separated} onChange={session.changeExplosion} />
      <button className="lesson-button lesson-primary" aria-label={t("lessons.saveView")} disabled={!ready || separated || !canSave} onClick={() => {
        const view = session.captureView();
        if (view) onSaveView(view, [...state.visibleIds]);
      }}><span className="lesson-action-full">{t("lessons.saveView")}</span><span className="lesson-action-short">{t("lessons.saveViewShort")}</span></button>
      <span className="lesson-view-status" role="status">{t(separated ? "lessons.restoreBeforeSave" : view ? "lessons.viewSaved" : "lessons.viewNotSaved")}</span>
    </div>, controls)}
    {createPortal(<>
      {showAxes && <div className="model-orientation"><OrientationAxes ref={orientation} disabled={!ready} onControl={session.control} /></div>}
      {!ready && <ViewerStatusNotice className="lesson-model-message" state={state} totalSystems={1} />}
      {ready && <LessonStructureTools key={sectionId} catalog={catalog} session={session} state={state} ids={ids} />}
      <div className="lesson-scene-feedback">
        {snapPart && <p className="model-status model-snap-hint" role="status">{t("viewer.snapHint", { name: snapPart.names[language] })}</p>}
        {separated && <p className="model-status separation-status" role="status">{t("context.dragHint")}</p>}
      </div>
      {createPortal(<PopoverPanel key={sectionId} id="lesson-scene-structures" className="lesson-scene-structures" contentClassName="catalog-tree lesson-scene-tree"
        title={t("lessons.sceneStructures")} closeLabel={t("lessons.closeSceneStructures")}>
        <p>{t("lessons.composeSceneHint")}</p>
        <div className="lesson-inspector-actions">
          <button className="lesson-button" disabled={!ready} onClick={() => onChangeScene(catalog.members(modelId))}>{t("catalog.showAll")}</button>
          <button className="lesson-button" disabled={!ready} onClick={() => onChangeScene([])}>{t("catalog.hideAll")}</button>
          <button className="lesson-button" disabled={!ready} onClick={() => onChangeScene(catalog.members(targetId))}>{t("lessons.resetScene")}</button>
        </div>
        <p role="status">{t("lessons.sceneCount", { count: ids.length })}</p>
        {ready ? <StructureTree catalog={catalog} rootId={modelId} visibleIds={shown} selected={state.readingId}
          targetId={state.targetId} reveal={reveal} disabled={!ready} onVisibility={(members, visible) => {
            const next = new Set(ids);
            members.forEach(id => { if (visible) next.add(id); else next.delete(id); });
            onChangeScene([...next]);
          }} onSelect={session.browseStructure} onTarget={session.browseTarget}
          onFocus={(members, target) => onChangeScene(target ? catalog.members(target) : members)} />
          : <p role="status">{t("viewer.status.loading")}</p>}
      </PopoverPanel>, document.body)}
      <button className={`lesson-button lesson-scene-fit${separated ? " lesson-scene-restore" : ""}`} disabled={!ready}
        onClick={() => separated ? session.restoreStructure("") : session.applyScene(ids, view)}>{t(separated ? "context.restore" : "lessons.resetStudyScene")}</button>
      <a className="lesson-model-credit" href="/models/z-anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer"
        aria-label={t("credit.link")}>Z-Anatomy</a>
    </>, frame)}
  </div>, frame);
}
