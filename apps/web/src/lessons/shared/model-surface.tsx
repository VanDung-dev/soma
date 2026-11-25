import type { ComponentProps, ReactNode } from "react";
import { ViewerOrientation } from "../../anatomy/orientation-axes";
import { LessonModelHud } from "./model-hud";
import type { useLessonViewer } from "./viewer";

type LessonViewer = ReturnType<typeof useLessonViewer>;

export function LessonModelCanvas({ viewer, className, inactive, busy = viewer.state.building && !viewer.state.error }: {
  viewer: LessonViewer;
  className?: string;
  inactive: boolean;
  busy?: boolean;
}) {
  return <div className={className ? `${className} model-canvas` : "model-canvas"} ref={viewer.host} inert={inactive} aria-busy={busy} />;
}

export function LessonModelSurface({ viewer, disabled = !viewer.ready, hud, children }: {
  viewer: LessonViewer;
  disabled?: boolean;
  hud: ComponentProps<typeof LessonModelHud>;
  children?: ReactNode;
}) {
  const { focusFrame, orientation, showAxes, fps, session } = viewer;
  return <>
    <div className="model-focus-frame" ref={focusFrame}>
      <ViewerOrientation orientation={orientation} showAxes={showAxes} disabled={disabled} onControl={session.control} fps={fps} />
    </div>
    <LessonModelHud state={viewer.state} {...hud} />
    {children}
  </>;
}
