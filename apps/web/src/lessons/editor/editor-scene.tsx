import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import { getCatalog } from "../../anatomy/core";
import type { Catalog } from "../../anatomy/catalog/types";
import { OrientationAxes } from "../../anatomy/orientation-axes";
import { ViewerStatusNotice } from "../../anatomy/viewer-status";
import { ExplodeControls } from "../../anatomy/explode-controls";
import { useLanguage } from "../../i18n";
import { useLessonViewer } from "../shared/viewer";
import { LessonStructureTools } from "./structure-tools";
import type { SceneView } from "../../anatomy/viewer/contracts";

type SceneProps = {
  modelIds: string[]; targetId: string; sectionId: string; frame: HTMLElement; inactive: boolean; tools: ReactNode;
  visibleIds?: string[]; onChangeScene: (ids: string[]) => void;
  view?: SceneView;
  sceneRef?: Ref<EditorSceneHandle>;
  revealPart?: { id: string; target?: boolean };
  onSceneChange?: () => void;
};

export type EditorSceneHandle = { capture: () => { view: SceneView; visibleIds: string[] } | undefined };

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

function Scene({ catalog, modelIds, targetId, sectionId, frame, inactive, tools, visibleIds, view, onChangeScene, sceneRef, revealPart, onSceneChange }: SceneProps & { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const ids = useMemo(() => visibleIds ?? catalog.members(targetId), [catalog, targetId, visibleIds]);
  const { host, orientation, showAxes, session, state, hold, snapTarget } = useLessonViewer(catalog, modelIds, undefined, frame,
    hiddenIds => {
      const hidden = new Set(hiddenIds);
      onChangeScene(ids.filter(id => !hidden.has(id)));
    }, true, false);
  const ready = !state.building && !state.error;
  const snapPart = useMemo(() => catalog.detail(snapTarget), [catalog, snapTarget, state.structureIds]);
  const separated = !!state.movingId || !!state.separatedIds.size;
  const revealedPart = useRef<{ id: string; target?: boolean }>(undefined);
  useImperativeHandle(sceneRef, () => ({ capture: () => {
    if (!ready || separated) return;
    const view = session.captureView();
    if (view) return { view, visibleIds: [...state.visibleIds] };
  } }), [ready, separated, session, state.visibleIds]);
  useEffect(() => {
    if (ready) session.applyScene(ids, view);
  }, [ready, session, sectionId, ids, view]);
  useEffect(() => {
    if (ready && revealPart && revealedPart.current !== revealPart && (revealPart.target || ids.includes(revealPart.id))) {
      if (revealPart.target) session.browseTarget(revealPart.id);
      else session.browseStructure(revealPart.id);
      revealedPart.current = revealPart;
    }
  }, [ready, session, ids, revealPart]);

  return createPortal(<div className="lesson-editor-scene" inert={inactive} aria-label={t("viewer.section.label")} role="group"
    onPointerDownCapture={onSceneChange} onWheelCapture={onSceneChange} onKeyDownCapture={onSceneChange}>
    <div className="model-canvas" ref={host} aria-busy={state.building && !state.error}>
      <div className="lesson-model-tools">
        <button className={`lesson-button lesson-scene-fit${separated ? " lesson-scene-restore" : ""}`} disabled={!ready}
          onClick={() => separated ? session.restoreStructure("") : session.applyScene(ids, view)}>{t(separated ? "context.restore" : "lessons.resetStudyScene")}</button>
        {tools}
        <ExplodeControls value={state.explosionAmount} disabled={!ready || separated} locked={separated} onChange={amount => {
          session.changeExplosion(amount);
          onSceneChange?.();
        }} />
        <a className="lesson-model-credit" href="/models/z-anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer"
          aria-label={t("credit.link")}>Z-Anatomy</a>
      </div>
    </div>
    {hold && <svg key={hold.action} className="model-hold-progress" data-action={hold.action} style={{ left: hold.x, top: hold.y }} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="16" />
      <circle className="model-hold-fill" cx="20" cy="20" r="16" pathLength="100" />
    </svg>}
    {createPortal(<>
      {showAxes && <div className="model-orientation"><OrientationAxes ref={orientation} disabled={!ready} onControl={session.control} /></div>}
      {state.error && <ViewerStatusNotice className="lesson-model-message" state={state} totalSystems={modelIds.length} />}
      {ready && <LessonStructureTools key={sectionId} catalog={catalog} session={session} state={state} ids={ids} searchable={false} />}
      <div className="lesson-scene-feedback">
        {snapPart && <p className="model-status model-snap-hint" role="status">{t("viewer.snapHint", { name: snapPart.names[language] })}</p>}
        {separated && <p className="model-status separation-status" role="status">{t("context.dragHint")}</p>}
      </div>
    </>, frame)}
  </div>, frame);
}
