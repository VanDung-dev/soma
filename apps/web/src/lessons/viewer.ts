import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Catalog } from "../anatomy/catalog/types";
import type { OrientationAxesHandle } from "../anatomy/orientation-axes";
import { StudySession } from "../anatomy/study/session";
import { useCameraKeys } from "../anatomy/use-camera-keys";
import { readGraphicsSettings } from "../anatomy/viewer/graphics";
import { viewportInFrame } from "../anatomy/viewer/layout";
import { ViewerRuntime } from "../anatomy/viewer/runtime";

export function useLessonViewer(catalog: Catalog, modelId: string, onPick?: (id: string) => void, frame?: HTMLElement) {
  const host = useRef<HTMLDivElement>(null);
  const orientation = useRef<OrientationAxesHandle>(null);
  const [graphics] = useState(readGraphicsSettings);
  const session = useMemo(() => new StudySession(catalog), [catalog, modelId]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useCameraKeys(!modelId || state.building || state.error, session.control, host);

  useEffect(() => {
    if (!modelId || !host.current) return;
    const root = catalog.roots.find(root => root.id === modelId);
    if (!root) {
      session.updateViewer({ error: true, building: false, status: "loadError" });
      return;
    }
    const canvasHost = host.current;
    const viewer = new ViewerRuntime(canvasHost, {
      viewport: () => frame ? viewportInFrame(canvasHost, frame) : [0.04, 0.04, 0.92, 0.92],
      viewportElement: frame,
      onState: session.updateViewer,
      onPick: id => { session.pick(id); onPick?.(id); },
      onHide: () => false,
      onOrientation: graphics.showAxes ? axes => orientation.current?.update(axes) : undefined,
      allowSeparation: false,
    });
    session.connect(viewer);
    viewer.setGraphics(graphics);
    void viewer.start(catalog, [root]);
    return () => { session.disconnect(viewer); viewer.dispose(); };
  }, [catalog, frame, graphics, modelId, onPick, session]);

  return { host, orientation, showAxes: graphics.showAxes, session, state };
}
