import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../i18n";
import { AlertCard } from "../pages/alert-card";
import { HandInteractionOverlay } from "./hand-interaction-overlay";
import { measureHandImage, measureHandRegion, type HandImageBounds } from "./hand-camera/layout";
import { startHandCamera, type HandCameraError, type HandFeedback } from "./hand-camera/camera";
import type { CameraCommand } from "../viewer/contracts";

export function HandCameraControls({ enabled, disabled, cameraDisabled = false, deviceId = "", onCameraStarted, onCameraActiveChange, onControl, sceneHost, interactionFrame,
  obstacles, onEnabledChange }: {
  enabled: boolean;
  disabled: boolean;
  cameraDisabled?: boolean;
  deviceId?: string;
  onCameraStarted?: () => void;
  onCameraActiveChange?: (active: boolean) => void;
  onControl: (commands: CameraCommand[]) => boolean;
  sceneHost: RefObject<HTMLDivElement | null>;
  interactionFrame: RefObject<HTMLDivElement | null>;
  obstacles: RefObject<HTMLElement | null>[];
  onEnabledChange: (enabled: boolean) => void;
}) {
  const { t } = useLanguage();
  const [aspect, setAspect] = useState(4 / 3);
  const [feedback, setFeedback] = useState<HandFeedback | null>(null);
  const [bounds, setBounds] = useState<HandImageBounds | null>(null);
  const [error, setError] = useState<HandCameraError | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const handsLayer = useRef<HTMLDivElement>(null);
  const enabledChanged = useEffectEvent(onEnabledChange);
  const cameraStarted = useEffectEvent(() => { onCameraStarted?.(); });
  const cameraActiveChanged = useEffectEvent((active: boolean) => { onCameraActiveChange?.(active); });
  const allowed = useEffectEvent(() => !disabled);
  const cameraAllowed = useEffectEvent(() => !cameraDisabled);
  const region = useEffectEvent(() => measureHandRegion(sceneHost.current!, video.current!, interactionFrame.current!,
    obstacles.flatMap(ref => ref.current ? [ref.current] : [])));
  const control = useEffectEvent((next: HandFeedback) => {
    setFeedback(next);
    if (next.hands.length) handsLayer.current?.showPopover();
    else handsLayer.current?.hidePopover();
    if (!cameraDisabled && next.commands.length) onControl(next.commands);
  });

  useEffect(() => {
    if (!enabled || !sceneHost.current) return;
    const measure = () => setBounds(measureHandImage(sceneHost.current!, aspect));
    const observer = new ResizeObserver(measure);
    observer.observe(sceneHost.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [enabled, sceneHost, aspect]);

  useEffect(() => {
    setFeedback(null);
    handsLayer.current?.hidePopover();
    if (!enabled) {
      return;
    }
    setError(null);
    return startHandCamera(video.current!, {
      deviceId, onStarted: cameraStarted, onActiveChange: cameraActiveChanged, allowed, cameraAllowed, region, onResult: control,
      onError: cause => { setError(cause); enabledChanged(false); },
    });
  }, [enabled, deviceId]);

  const overlay = enabled && feedback && bounds && <div className="hand-camera-scene-overlay"
    style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, right: "auto", bottom: "auto" }}>
    <div className="hand-camera-image-area" style={{ width: "100%", height: "100%" }}>
      <HandInteractionOverlay feedback={feedback} aspect={aspect} interactive={!disabled && !cameraDisabled} />
    </div>
  </div>;
  return <>
    {sceneHost.current && createPortal(<video ref={video} className="hand-camera-scene" hidden autoPlay muted playsInline
      aria-label={t("handCamera.preview")} onResize={() => {
        if (video.current?.videoHeight) setAspect(video.current.videoWidth / video.current.videoHeight);
      }} />, sceneHost.current)}
    {sceneHost.current && createPortal(<div ref={handsLayer} className="hand-visual-overlay" popover="manual"
      data-hand-visual="true" aria-hidden="true">{overlay}</div>, document.body)}
    {error && <AlertCard title={t("handCamera.error.title")} message={t(`handCamera.error.${error}`)}
      onCancel={() => setError(null)} actions={[
        { label: t("handCamera.error.close"), onClick: () => setError(null) },
        { label: t("handCamera.error.retry"), primary: true, disabled, onClick: () => { setError(null); onEnabledChange(true); } },
      ]} />}
  </>;
}
