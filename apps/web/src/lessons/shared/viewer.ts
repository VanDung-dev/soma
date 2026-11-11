import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import type { OrientationAxesHandle } from "../../anatomy/orientation-axes";
import { StudySession } from "../../anatomy/study/session";
import { useCameraKeys } from "../../anatomy/use-camera-keys";
import type { GraphicsSettings } from "../../anatomy/viewer/graphics";
import { viewportInFrame } from "../../anatomy/viewer/layout";
import { ViewerRuntime } from "../../anatomy/viewer/runtime";
import { shortcutAction } from "../../shortcuts";

export function useLessonViewer(catalog: Catalog, graphics: GraphicsSettings, modelId: string | readonly string[], onPick?: (id: string) => void, frame?: HTMLElement | RefObject<HTMLElement | null>,
  onEditVisibility?: (hiddenIds: string[]) => void, allowSeparation = true, animateInitialReconstruction = true, background = false) {
  const host = useRef<HTMLDivElement>(null);
  const orientation = useRef<OrientationAxesHandle>(null);
  const runtime = useRef<ViewerRuntime | null>(null);
  const [fps, setFps] = useState(0);
  const [hold, setHold] = useState<{ x: number; y: number; action: "hide" | "move" } | null>(null);
  const [snapTarget, setSnapTarget] = useState("");
  const modelKey = typeof modelId === "string" ? modelId : modelId.join(",");
  const canSelect = useEffectEvent(() => allowSeparation);
  const sessionKey = modelKey;
  const session = useMemo(() => new StudySession(catalog), [catalog, sessionKey]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useCameraKeys(!modelKey || state.building || state.error, session.control, host);
  const hide = useEffectEvent((ids: string[]) => {
    if (!allowSeparation || !session.changeVisibility(ids, false)) return false;
    onEditVisibility?.(ids);
    return true;
  });

  useEffect(() => {
    if ((!sessionKey && !background) || !host.current) return;
    const canvasHost = host.current;
    const viewportFrame = frame && ("current" in frame ? frame.current : frame);
    const viewer = new ViewerRuntime(canvasHost, {
      viewport: () => viewportFrame ? viewportInFrame(canvasHost, viewportFrame) : [0.04, 0.04, 0.92, 0.92],
      viewportElement: viewportFrame ?? undefined,
      onState: session.updateViewer,
      onPick: id => { session.pick(id); onPick?.(id); },
      onHide: ids => hide(ids),
      onHold: setHold,
      onSnap: setSnapTarget,
      onFps: setFps,
      onOrientation: axes => orientation.current?.update(axes),
      canSeparate: () => false,
      canSelect,
      preserveCameraOnResize: true,
      animateInitialReconstruction,
      background,
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
  }, [catalog, frame, sessionKey, onPick, session, background]);
  useEffect(() => {
    if ((!modelKey && !background) || !runtime.current) return;
    const ids = modelKey ? modelKey.split(",") : [];
    const roots = catalog.roots.filter(root => ids.includes(root.id));
    if (roots.length !== ids.length) {
      session.updateViewer({ error: true, building: false, status: "loadError" });
      return;
    }
    void runtime.current.start(catalog, roots);
  }, [catalog, frame, modelKey, onPick, session, background]);
  useEffect(() => { runtime.current?.setGraphics(graphics); }, [graphics, session, frame, onPick]);

  return { host, orientation, showAxes: graphics.showAxes, fps, session, state, hold, snapTarget, runtime };
}
