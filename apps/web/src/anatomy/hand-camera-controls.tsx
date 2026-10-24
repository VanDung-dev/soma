import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../i18n";
import type { CameraCommand } from "./viewer/contracts";
import { startHandCamera } from "./viewer/hand-camera";
import type { HandCameraError, HandFeedback } from "./viewer/hand-camera";
import { HandInteractionOverlay } from "./hand-interaction-overlay";
import { measureHandRegion } from "./viewer/layout";

export function HandCameraControls({ disabled, onControl, sceneHost, interactionFrame, obstacles, onBackground }: {
  disabled: boolean;
  onControl: (commands: CameraCommand[]) => boolean;
  sceneHost: RefObject<HTMLDivElement | null>;
  interactionFrame: RefObject<HTMLDivElement | null>;
  obstacles: RefObject<HTMLElement | null>[];
  onBackground: (active: boolean) => void;
}) {
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState(false);
  const [scene, setScene] = useState(false);
  const [aspect, setAspect] = useState(4 / 3);
  const [feedback, setFeedback] = useState<HandFeedback | null>(null);
  const [error, setError] = useState<HandCameraError | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const detailsId = useId();
  const background = enabled && scene && feedback !== null;
  const changeBackground = useEffectEvent(onBackground);
  useEffect(() => {
    changeBackground(background);
    return () => changeBackground(false);
  }, [background]);
  const allowed = useEffectEvent(() => !disabled);
  const region = useEffectEvent(() => measureHandRegion(sceneHost.current!, video.current!, interactionFrame.current!,
    [panel.current!, ...obstacles.flatMap(ref => ref.current ? [ref.current] : [])]));
  const control = useEffectEvent((next: HandFeedback) => {
    setFeedback(next);
    if (next.commands.length) onControl(next.commands);
  });
  useEffect(() => {
    if (!enabled) return;
    return startHandCamera(video.current!, {
      allowed, region, onResult: control,
      onError: cause => { setError(cause); setEnabled(false); },
    });
  }, [enabled]);
  const overlay = enabled && !disabled && feedback && <HandInteractionOverlay feedback={feedback} aspect={aspect} />;
  return <>
    {sceneHost.current && createPortal(<>
      <video ref={video} className="hand-camera-scene" hidden={!background} autoPlay muted playsInline
        aria-label={t("handCamera.preview")} onResize={() => {
          if (video.current?.videoHeight) setAspect(video.current.videoWidth / video.current.videoHeight);
        }} />
      {overlay && <div className="hand-camera-scene-overlay" aria-hidden="true">
        <div className="hand-camera-image-area" style={{ width: `min(100cqw, ${aspect * 100}cqh)`, height: `min(100cqh, ${100 / aspect}cqw)` }}>
          {overlay}
        </div>
      </div>}
    </>, sceneHost.current)}
    <div ref={panel} className="hand-camera" data-enabled={enabled}>
      <button className="hand-camera-toggle" aria-pressed={enabled} aria-controls={detailsId}
        disabled={!enabled && disabled} onClick={() => {
          setError(null); setFeedback(null); setEnabled(value => !value);
        }}>{t(enabled ? "handCamera.stop" : "handCamera.start")}</button>
      <div id={detailsId} hidden={!enabled}>
        <button className="hand-camera-scene-toggle" aria-pressed={scene}
          onClick={() => setScene(value => !value)}>{t("handCamera.scene")}</button>
      </div>
      {error && <p className="hand-camera-error" role="alert">{t(`handCamera.error.${error}`)}</p>}
    </div>
  </>;
}
