import type { Ref } from "react";
import { OrientationAxes } from "../../anatomy/orientation-axes";
import type { OrientationAxesHandle } from "../../anatomy/orientation-axes";
import type { CameraCommand } from "../../anatomy/viewer/contracts";
import { useLanguage } from "../../i18n";

export function LessonModelFrame({ ref, orientation, showAxes, disabled, onControl, fps }: {
  ref: Ref<HTMLDivElement>;
  orientation: Ref<OrientationAxesHandle>;
  showAxes: boolean;
  disabled: boolean;
  onControl: (commands: CameraCommand[]) => boolean;
  fps?: number;
}) {
  const { t } = useLanguage();
  return <div className="model-focus-frame" ref={ref}>
    <div className="model-orientation">
      <div hidden={!showAxes}>
        <OrientationAxes ref={orientation} disabled={disabled || !showAxes} onControl={onControl} />
      </div>
      {fps !== undefined && <span className="model-fps" aria-label={t("graphics.fps.current", { count: fps || "—" })}>{fps || "—"} FPS</span>}
    </div>
  </div>;
}
