import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import type { OrientationAxesHandle } from "../../anatomy/orientation-axes";
import { StudySession } from "../../anatomy/study/session";
import { useCameraKeys } from "../../anatomy/use-camera-keys";
import { readGraphicsSettings } from "../../anatomy/viewer/graphics";
import { viewportInFrame } from "../../anatomy/viewer/layout";
import { ViewerRuntime } from "../../anatomy/viewer/runtime";
import { shortcutAction } from "../../shortcuts";

export function useLessonViewer(catalog: Catalog, modelId: string | readonly string[], onPick?: (id: string) => void, frame?: HTMLElement,
  onEditVisibility?: (hiddenIds: string[]) => void, allowSeparation = true) {
  const host = useRef<HTMLDivElement>(null);
  const orientation = useRef<OrientationAxesHandle>(null);
  const [graphics] = useState(readGraphicsSettings);
  const [hold, setHold] = useState<{ x: number; y: number; action: "hide" | "move" } | null>(null);
  const [snapTarget, setSnapTarget] = useState("");
  const modelKey = typeof modelId === "string" ? modelId : modelId.join(",");
  const canSeparate = useEffectEvent(() => allowSeparation);
  const session = useMemo(() => new StudySession(catalog), [catalog, modelKey]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useCameraKeys(!modelKey || state.building || state.error, session.control, host);
  const hide = useEffectEvent((ids: string[]) => {
    if (!allowSeparation || !session.changeVisibility(ids, false)) return false;
    onEditVisibility?.(ids);
    return true;
  });

  useEffect(() => {
    if (!modelKey || !host.current) return;
    const ids = modelKey.split(",");
    const roots = catalog.roots.filter(root => ids.includes(root.id));
    if (roots.length !== ids.length) {
      session.updateViewer({ error: true, building: false, status: "loadError" });
      return;
    }
    const canvasHost = host.current;
    const viewer = new ViewerRuntime(canvasHost, {
      viewport: () => frame ? viewportInFrame(canvasHost, frame) : [0.04, 0.04, 0.92, 0.92],
      viewportElement: frame,
      onState: session.updateViewer,
      onPick: id => { session.pick(id); onPick?.(id); },
      onHide: ids => hide(ids),
      onHold: setHold,
      onSnap: setSnapTarget,
      onOrientation: graphics.showAxes ? axes => orientation.current?.update(axes) : undefined,
      canSeparate,
      canSelect: canSeparate,
      preserveCameraOnResize: true,
    });
    const keyDown = (event: KeyboardEvent) => {
      if (canSeparate() && shortcutAction(event) === "restore") {
        event.preventDefault();
        session.restoreStructure("");
      }
    };
    canvasHost.addEventListener("keydown", keyDown);
    session.connect(viewer);
    viewer.setGraphics(graphics);
    void viewer.start(catalog, roots);
    return () => { canvasHost.removeEventListener("keydown", keyDown); session.disconnect(viewer); viewer.dispose(); };
  }, [catalog, frame, graphics, modelKey, onPick, session]);

  return { host, orientation, showAxes: graphics.showAxes, session, state, hold, snapTarget };
}
