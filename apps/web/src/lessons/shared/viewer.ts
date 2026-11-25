import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import type { OrientationAxesHandle } from "../../anatomy/orientation-axes";
import { StudySession } from "../../anatomy/study/session";
import { useCameraKeys } from "../../anatomy/use-camera-keys";
import type { ViewerHold } from "../../anatomy/viewer/contracts";
import { viewportInFrame } from "../../anatomy/viewer/layout";
import { ViewerRuntime } from "../../anatomy/viewer/runtime";
import { useGraphicsSettings } from "../../pages/use-graphics-settings";
import { shortcutAction } from "../../shortcuts";
import type { LessonScene } from "./contract";
import { lessonSceneVisibleIds } from "./targets";

export function useLessonSceneVisibleIds(catalog: Catalog, scene?: Pick<LessonScene, "targetId" | "visibleIds">) {
  const { targetId, visibleIds } = scene ?? {};
  return useMemo(() => lessonSceneVisibleIds(catalog, targetId === undefined ? undefined : { targetId, visibleIds }),
    [catalog, targetId, visibleIds]);
}

export function useLessonViewer({ catalog, modelIds, scene, visible, sceneUsable = true, sectionId, resetVersion, authoring }: {
  catalog: Catalog;
  modelIds: readonly string[];
  scene?: Pick<LessonScene, "targetId" | "visibleIds" | "view">;
  visible: boolean;
  sceneUsable?: boolean;
  sectionId?: string | null;
  resetVersion?: number;
  authoring?: { onVisibilityChange: (visibleIds: string[]) => void; onCameraChange?: () => void };
}) {
  const [graphics] = useGraphicsSettings();
  const host = useRef<HTMLDivElement>(null);
  const focusFrame = useRef<HTMLDivElement>(null);
  const orientation = useRef<OrientationAxesHandle>(null);
  const runtime = useRef<ViewerRuntime | null>(null);
  const [fps, setFps] = useState(0);
  const [hold, setHold] = useState<ViewerHold | null>(null);
  const [snapTarget, setSnapTarget] = useState("");
  const [sceneFailed, setSceneFailed] = useState(false);
  const ids = useLessonSceneVisibleIds(catalog, scene);
  const view = scene?.view;
  const editing = !!authoring;
  const modelKey = modelIds.join(",");
  const canSelect = useEffectEvent(() => !!authoring && visible);
  const cameraChanged = useEffectEvent(() => authoring?.onCameraChange?.());
  const sessionKey = editing ? "" : modelKey;
  const session = useMemo(() => new StudySession(catalog), [catalog, sessionKey]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const ready = !state.building && !state.error && !sceneFailed;
  useCameraKeys(!modelKey || state.building || state.error, session.control, host);
  const hide = useEffectEvent((hiddenIds: string[]) => {
    if (!authoring || !visible || !session.changeVisibility(hiddenIds, false)) return false;
    const hidden = new Set(hiddenIds);
    authoring.onVisibilityChange(ids.filter(id => !hidden.has(id)));
    return true;
  });

  useEffect(() => {
    if (!host.current) return;
    const canvasHost = host.current;
    const viewportFrame = focusFrame.current;
    const viewer = new ViewerRuntime(canvasHost, {
      viewport: () => viewportFrame ? viewportInFrame(canvasHost, viewportFrame) : [0.04, 0.04, 0.92, 0.92],
      viewportElement: viewportFrame ?? undefined,
      onState: session.updateViewer,
      onCameraChange: cameraChanged,
      onPick: session.pick,
      onHide: ids => hide(ids),
      onHold: setHold,
      onSnap: setSnapTarget,
      onFps: setFps,
      onOrientation: axes => orientation.current?.update(axes),
      canSeparate: () => false,
      canSelect,
      preserveCameraOnResize: true,
      animateInitialReconstruction: false,
      background: true,
    });
    const keyDown = (event: KeyboardEvent) => {
      if (canSelect() && shortcutAction(event) === "restore") {
        event.preventDefault();
        session.restoreStructure("");
      }
    };
    canvasHost.addEventListener("keydown", keyDown);
    runtime.current = viewer;
    session.connect(viewer);
    return () => {
      canvasHost.removeEventListener("keydown", keyDown); session.disconnect(viewer); viewer.dispose();
      if (runtime.current === viewer) runtime.current = null;
    };
  }, [session]);
  useEffect(() => {
    const viewer = runtime.current;
    if (!viewer) return;
    const requestedIds = modelKey ? modelKey.split(",") : [];
    const roots = catalog.roots.filter(root => requestedIds.includes(root.id));
    if (roots.length !== requestedIds.length) {
      session.updateViewer({ error: true, building: false, status: "loadError" });
      return;
    }
    if (editing) void viewer.updateBackgroundModels(catalog, roots, () => session.getSnapshot().visibleIds);
    else void viewer.start(catalog, roots);
  }, [catalog, editing, modelKey, session]);
  useEffect(() => { runtime.current?.setGraphics(graphics); }, [graphics, session]);

  const resize = useCallback(() => runtime.current?.resize(), []);
  const applyScene = useCallback(() => session.applyScene(ids, view), [session, ids, view]);

  useEffect(() => {
    const animation = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(animation);
  }, [visible, resize, session]);

  useEffect(() => {
    if (!ready) return;
    if (!visible || !sceneUsable) { session.changeVisibility(state.structureIds, false); return; }
    const animation = requestAnimationFrame(() => {
      if (!applyScene() && !editing) setSceneFailed(true);
    });
    return () => cancelAnimationFrame(animation);
  }, [ready, visible, sceneUsable, editing, applyScene, sectionId, resetVersion, session, state.structureIds]);

  return { host, focusFrame, orientation, showAxes: graphics.showAxes, fps: graphics.showFps ? fps : undefined,
    session, state, hold, snapTarget, ids, ready, sceneFailed, resize, applyScene };
}
