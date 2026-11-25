import type { Ref } from "react";
import { ViewerOrientation } from "../../anatomy/orientation-axes";
import type { OrientationAxesHandle } from "../../anatomy/orientation-axes";
import type { CameraCommand } from "../../anatomy/viewer/contracts";

export function LessonModelFrame({ ref, orientation, showAxes, disabled, onControl, fps }: {
  ref: Ref<HTMLDivElement>;
  orientation: Ref<OrientationAxesHandle>;
  showAxes: boolean;
  disabled: boolean;
  onControl: (commands: CameraCommand[]) => boolean;
  fps?: number;
}) {
  return <div className="model-focus-frame" ref={ref}>
    <ViewerOrientation orientation={orientation} showAxes={showAxes} disabled={disabled} onControl={onControl} fps={fps} />
  </div>;
}
