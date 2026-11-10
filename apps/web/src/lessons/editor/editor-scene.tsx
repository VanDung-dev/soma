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
import type { GraphicsSettings } from "../../anatomy/viewer/graphics";

type SceneProps = {
  graphics: GraphicsSettings;
  modelIds: string[]; targetId: string; sectionId: string; frame: HTMLElement; inactive: boolean; tools: ReactNode;
  outlineOpen: boolean;
  visibleIds?: string[]; onChangeScene: (ids: string[]) => void;
  view?: SceneView;
  sceneRef?: Ref<EditorSceneHandle>;
  revealPart?: { id: string; target?: boolean };
  onSceneChange?: () => void;
  onResetScene: () => void;
  resetVersion: number;
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

function Scene({ catalog, graphics, modelIds, targetId, sectionId, frame, inactive, outlineOpen, tools, visibleIds, view, onChangeScene, sceneRef, revealPart, onSceneChange, onResetScene, resetVersion }: SceneProps & { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const ids = useMemo(() => visibleIds ?? catalog.members(targetId), [catalog, targetId, visibleIds]);
  const focusFrame = useRef<HTMLDivElement>(null);
  const { host, orientation, showAxes, fps, session, state, hold, snapTarget, runtime } = useLessonViewer(catalog, graphics, modelIds, undefined, focusFrame,
    hiddenIds => {
      const hidden = new Set(hiddenIds);
      onChangeScene(ids.filter(id => !hidden.has(id)));
    }, !inactive, false, true);
  const ready = !state.building && !state.error;
  const snapPart = useMemo(() => catalog.detail(snapTarget), [catalog, snapTarget, state.structureIds]);
  const separated = !!state.movingId || !!state.separatedIds.size;
  const revealedPart = useRef<{ id: string; target?: boolean }>(undefined);
  useEffect(() => {
    const workspace = frame.closest(".lesson-author-workspace")!;
    const scroller = frame.closest(".lesson-author-center")!;
    let animation = 0;
    const resize = () => runtime.current?.resize();
    const update = () => {
      resize();
      if ([workspace, scroller].some(element => element.getAnimations().some(animation => animation.playState === "running"))) animation = requestAnimationFrame(update);
    };
    animation = requestAnimationFrame(update);
    scroller.addEventListener("scroll", resize);
    return () => { cancelAnimationFrame(animation); scroller.removeEventListener("scroll", resize); };
  }, [frame, outlineOpen, inactive, runtime, session]);
  useImperativeHandle(sceneRef, () => ({ capture: () => {
    if (!ready || separated) return;
    const view = session.captureView();
    if (view) return { view, visibleIds: [...state.visibleIds] };
  } }), [ready, separated, session, state.visibleIds]);
  useEffect(() => {
    if (!ready) return;
    if (inactive) { session.changeVisibility(state.structureIds, false); return; }
    const scroller = frame.closest(".lesson-author-center")!;
    let animation = 0;
    const apply = () => {
      if (scroller.getAnimations().some(animation => animation.playState === "running")) animation = requestAnimationFrame(apply);
      else session.applyScene(ids, view);
    };
    animation = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(animation);
  }, [ready, inactive, session, sectionId, ids, view, state.structureIds, frame, resetVersion]);
  useEffect(() => {
    if (ready && !inactive && revealPart && revealedPart.current !== revealPart && (revealPart.target || ids.includes(revealPart.id))) {
      if (revealPart.target) session.browseTarget(revealPart.id);
      else session.browseStructure(revealPart.id);
      revealedPart.current = revealPart;
    }
  }, [ready, inactive, session, ids, revealPart]);

  return createPortal(<div className="lesson-editor-scene" inert={inactive} data-active={!inactive} aria-hidden={inactive} aria-label={t("viewer.section.label")} role="group"
    onPointerDownCapture={onSceneChange} onWheelCapture={onSceneChange} onKeyDownCapture={onSceneChange}>
    {createPortal(<div className="model-canvas" ref={host} inert={inactive} aria-busy={state.building && !state.error} />,
      frame.closest(".lesson-editor")!)}
    <div className="model-focus-frame" ref={focusFrame}>
      <div className="model-orientation">
        <div hidden={!showAxes}>
          <OrientationAxes ref={orientation} disabled={!ready || !showAxes} onControl={session.control} />
        </div>
        {graphics.showFps && <span className="model-fps" aria-label={t("graphics.fps.current", { count: fps })}>{fps} FPS</span>}
      </div>
    </div>
    <div className="model-hud lesson-editor-hud">
      {ready && <LessonStructureTools key={sectionId} catalog={catalog} session={session} state={state} ids={ids} searchable={false} />}
      {snapPart && <p className="model-status model-snap-hint" role="status">{t("viewer.snapHint", { name: snapPart.names[language] })}</p>}
      {separated && <p className="model-status separation-status" role="status">{t("context.dragHint")}</p>}
      <ViewerStatusNotice state={state} totalSystems={modelIds.length} />
      {state.building && !state.error && <progress className="model-progress" aria-label={t("viewer.loading.systems")}
        value={state.loadedSystems} max={modelIds.length} />}
      <div className="lesson-model-tools">
        <button className="lesson-button lesson-scene-fit" disabled={!ready}
          onClick={onResetScene}>{t("lessons.resetStudyScene")}</button>
        {!inactive && tools}
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
  </div>, frame);
}
