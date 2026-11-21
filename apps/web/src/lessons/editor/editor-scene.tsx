import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import { getCatalog } from "../../anatomy/core";
import type { Catalog } from "../../anatomy/catalog/types";
import { ExplodeControls } from "../../anatomy/explode-controls";
import { useLanguage } from "../../i18n";
import { useLessonViewer } from "../shared/viewer";
import { LessonModelHud } from "../shared/model-hud";
import { LessonModelFrame } from "../shared/model-frame";
import { LessonStructureTools } from "./structure-tools";
import type { SceneView } from "../../anatomy/viewer/contracts";
import type { GraphicsSettings } from "../../anatomy/viewer/graphics";

type SceneProps = {
  graphics: GraphicsSettings;
  modelIds: string[]; targetId: string; sectionId: string; frame: HTMLElement; inactive: boolean;
  settingsButton: ReactNode;
  settingsControlsHost: HTMLElement | null;
  settingsActionsHost: HTMLElement | null;
  visibleIds?: string[]; onChangeScene: (ids: string[]) => void;
  view?: SceneView;
  sceneRef?: Ref<EditorSceneHandle>;
  revealPart?: { id: string; target?: boolean };
  onSceneChange?: () => void;
  onReloadModel: () => void;
  reloadVersion: number;
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

  if (catalog) return <Scene key={props.reloadVersion} catalog={catalog} {...props} />;
  return createPortal(<LessonModelHud className="lesson-editor-hud" showCredit={false} actions={!props.inactive && props.settingsButton}
    status={<p className={`model-status${failed ? " model-error" : ""}`} role={failed ? "alert" : "status"}>
      {t(failed ? "lessons.targetError" : "viewer.status.loading")}
    </p>} />, props.frame);
}

function Scene({ catalog, graphics, modelIds, targetId, sectionId, frame, inactive, settingsButton, settingsControlsHost, settingsActionsHost, visibleIds, view, onChangeScene, sceneRef, revealPart, onSceneChange, onReloadModel, resetVersion }: SceneProps & { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const ids = useMemo(() => visibleIds ?? catalog.members(targetId), [catalog, targetId, visibleIds]);
  const focusFrame = useRef<HTMLDivElement>(null);
  const { host, orientation, showAxes, fps, session, state, hold, snapTarget, runtime } = useLessonViewer(catalog, graphics, modelIds, undefined, focusFrame,
    hiddenIds => {
      const hidden = new Set(hiddenIds);
      onChangeScene(ids.filter(id => !hidden.has(id)));
    }, !inactive, false, true, onSceneChange, "append");
  const ready = !state.building && !state.error;
  const hudState = useMemo(() => {
    const requested = new Set(modelIds.flatMap(id => catalog.members(id)));
    return { ...state, structureIds: state.structureIds.filter(id => requested.has(id)),
      visibleIds: new Set([...state.visibleIds].filter(id => requested.has(id))) };
  }, [catalog, modelIds, state]);
  const snapPart = useMemo(() => catalog.detail(snapTarget), [catalog, snapTarget, state.structureIds]);
  const separated = !!state.movingId || !!state.separatedIds.size;
  const revealedPart = useRef<{ id: string; target?: boolean }>(undefined);
  useEffect(() => {
    const scroller = frame.closest(".lesson-author-center")!;
    const resize = () => runtime.current?.resize();
    const animation = requestAnimationFrame(resize);
    scroller.addEventListener("scroll", resize);
    return () => { cancelAnimationFrame(animation); scroller.removeEventListener("scroll", resize); };
  }, [frame, inactive, runtime, session]);
  useImperativeHandle(sceneRef, () => ({ capture: () => {
    if (!ready || separated) return;
    const view = session.captureView();
    if (view) return { view, visibleIds: [...state.visibleIds] };
  } }), [ready, separated, session, state.visibleIds]);
  useEffect(() => {
    if (!ready) return;
    if (inactive) { session.changeVisibility(state.structureIds, false); return; }
    const animation = requestAnimationFrame(() => session.applyScene(ids, view));
    return () => cancelAnimationFrame(animation);
  }, [ready, inactive, session, sectionId, ids, view, state.structureIds, frame, resetVersion]);
  useEffect(() => {
    if (!ready || inactive || !revealPart || revealedPart.current === revealPart || (!revealPart.target && !ids.includes(revealPart.id))) return;
    const animation = requestAnimationFrame(() => {
      const revealed = revealPart.target ? session.browseTarget(revealPart.id) : session.browseStructure(revealPart.id);
      if (revealed) revealedPart.current = revealPart;
    });
    return () => cancelAnimationFrame(animation);
  }, [ready, inactive, session, ids, revealPart]);

  return <>
    {settingsControlsHost && createPortal(
      <ExplodeControls value={state.explosionAmount} disabled={inactive || !ready || separated} locked={separated} onChange={amount => {
        session.changeExplosion(amount);
        onSceneChange?.();
      }} />, settingsControlsHost)}
    {settingsActionsHost && createPortal(<>
      <button className="lesson-button" disabled={inactive || !ready}
        onClick={() => { if (session.control([{ kind: "reset" }])) onSceneChange?.(); }}>{t("lessons.resetModelScene")}</button>
      <button className="lesson-button" disabled={inactive || !ready || separated}
        onClick={onReloadModel}>{t("lessons.reloadModel")}</button>
    </>, settingsActionsHost)}
    {createPortal(<div className="lesson-editor-scene lesson-model-surface" inert={inactive} data-active={!inactive} aria-hidden={inactive} aria-label={t("viewer.section.label")} role="group">
      {createPortal(<div className="model-canvas" ref={host} inert={inactive} aria-busy={state.building && !state.error} />,
        frame.closest(".lesson-editor")!)}
      <LessonModelFrame ref={focusFrame} orientation={orientation} showAxes={showAxes} disabled={!ready}
        onControl={session.control} fps={graphics.showFps ? fps : undefined} />
      <LessonModelHud className="lesson-editor-hud" state={hudState} totalSystems={modelIds.length}
        actions={!inactive && settingsButton}
        beforeStatus={<>
          {snapPart && <p className="model-status model-snap-hint" role="status">{t("viewer.snapHint", { name: snapPart.names[language] })}</p>}
          {separated && <p className="model-status separation-status" role="status">{t("context.dragHint")}</p>}
        </>} />
      {ready && <LessonStructureTools key={sectionId} catalog={catalog} session={session} state={state} ids={ids} />}
      {hold && <svg key={hold.action} className="model-hold-progress" data-action={hold.action} style={{ left: hold.x, top: hold.y }} viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="16" />
        <circle className="model-hold-fill" cx="20" cy="20" r="16" pathLength="100" />
      </svg>}
    </div>, frame)}
  </>;
}
