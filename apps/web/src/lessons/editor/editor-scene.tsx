import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import type { Catalog } from "../../anatomy/catalog/types";
import { ExplodeControls } from "../../anatomy/explode-controls";
import { useCatalog } from "../../anatomy/use-catalog";
import { ViewerHoldProgress } from "../../anatomy/viewer-status";
import { useLanguage } from "../../i18n";
import type { SceneView } from "../../anatomy/viewer/contracts";
import type { LessonScene } from "../shared/contract";
import { useLessonViewer } from "../shared/viewer";
import { LessonModelHud } from "../shared/model-hud";
import { LessonModelCanvas, LessonModelSurface } from "../shared/model-surface";
import { LessonStructureTools } from "./structure-tools";

type SceneProps = {
  modelIds: string[]; scene: LessonScene; sectionId: string; frame: HTMLElement; inactive: boolean;
  settingsButton: ReactNode;
  settingsControlsHost: HTMLElement | null;
  settingsActionsHost: HTMLElement | null;
  onChangeScene: (ids: string[]) => void;
  sceneRef?: Ref<EditorSceneHandle>;
  revealPart?: { id: string; target?: boolean };
  onSceneChange?: () => void;
  onReloadModel: () => void;
  reloadVersion: number;
  resetVersion: number;
};

export type EditorSceneHandle = { capture: () => { view: SceneView; visibleIds: string[] } | undefined; resize: () => void };

export function EditorScene(props: SceneProps) {
  const { t } = useLanguage();
  const { catalog, failed } = useCatalog("Lesson scene catalog failed");

  if (catalog) return <Scene key={props.reloadVersion} catalog={catalog} {...props} />;
  return createPortal(<LessonModelHud className="lesson-editor-hud" showCredit={false} actions={!props.inactive && props.settingsButton}
    status={<p className={`model-status${failed ? " model-error" : ""}`} role={failed ? "alert" : "status"}>
      {t(failed ? "lessons.targetError" : "viewer.status.loading")}
    </p>} />, props.frame);
}

function Scene({ catalog, modelIds, scene, sectionId, frame, inactive, settingsButton, settingsControlsHost, settingsActionsHost, onChangeScene, sceneRef, revealPart, onSceneChange, onReloadModel, resetVersion }: SceneProps & { catalog: Catalog }) {
  const { language, t } = useLanguage();
  const viewer = useLessonViewer({ catalog, modelIds, scene, visible: !inactive, sectionId, resetVersion,
    authoring: { onVisibilityChange: onChangeScene, onCameraChange: onSceneChange } });
  const { ids, ready, session, state, hold, snapTarget, resize } = viewer;
  const hudState = useMemo(() => {
    const requested = new Set(modelIds.flatMap(id => catalog.members(id)));
    return { ...state, structureIds: state.structureIds.filter(id => requested.has(id)),
      visibleIds: new Set([...state.visibleIds].filter(id => requested.has(id))) };
  }, [catalog, modelIds, state]);
  const snapPart = useMemo(() => catalog.detail(snapTarget), [catalog, snapTarget, state.structureIds]);
  const separated = !!state.movingId || !!state.separatedIds.size;
  const revealedPart = useRef<{ id: string; target?: boolean }>(undefined);
  useImperativeHandle(sceneRef, () => ({
    capture: () => {
      if (!ready || separated) return;
      const view = session.captureView();
      if (view) return { view, visibleIds: [...state.visibleIds] };
    },
    resize,
  }), [ready, separated, session, state.visibleIds, resize]);
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
      {createPortal(<LessonModelCanvas viewer={viewer} inactive={inactive} />, frame.closest(".lesson-editor")!)}
      <LessonModelSurface viewer={viewer} hud={{ className: "lesson-editor-hud", state: hudState, totalSystems: modelIds.length,
        actions: !inactive && settingsButton,
        beforeStatus: <>
          {snapPart && <p className="model-status model-snap-hint" role="status">{t("viewer.snapHint", { name: snapPart.names[language] })}</p>}
          {separated && <p className="model-status separation-status" role="status">{t("context.dragHint")}</p>}
        </>,
      }}>
        {ready && <LessonStructureTools key={sectionId} catalog={catalog} session={session} state={state} ids={ids} />}
        {hold && <ViewerHoldProgress key={hold.action} hold={hold} />}
      </LessonModelSurface>
    </div>, frame)}
  </>;
}
