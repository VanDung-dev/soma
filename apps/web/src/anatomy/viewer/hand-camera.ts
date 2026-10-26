import type { CameraCommand } from "./contracts";

export type HandMode = "idle" | "rotate" | "pan" | "zoom" | "paused";
export interface HandFeedback {
  mode: HandMode;
  hands: { side: "left" | "right"; x: number; y: number; pinching: boolean; state: "outside" | "ready" | "release" | "active"; landmarks: [number, number, number][] }[];
  region: number[];
  zoom: "none" | "in" | "out";
  commands: CameraCommand[];
}
export const emptyHandFeedback: HandFeedback = { mode: "idle", hands: [], region: [], zoom: "none", commands: [] };
export type HandCameraError = "unsupported" | "camera" | "model" | "processing";

export function startHandCamera(video: HTMLVideoElement, options: {
  deviceId?: string;
  onStarted?: () => void;
  onActiveChange?: (active: boolean) => void;
  allowed: () => boolean;
  cameraAllowed?: () => boolean;
  region: () => number[];
  onResult: (feedback: HandFeedback) => void;
  onError: (error: HandCameraError) => void;
}) {
  let disposed = false, busy = false, ready = false, frame = 0, timer = 0, feedbackTimer = 0, manualUntil = 0;
  let lastVideoTime = -1, lastCapture = -Infinity, paused = false;
  let lastSuspended: boolean | undefined;
  let stream: MediaStream | undefined;
  let worker: Worker | undefined;
  const pointers = new Set<number>(), keys = new Set<string>();
  const interrupt = () => { manualUntil = performance.now() + 400; };
  const pointerDown = (event: PointerEvent) => { pointers.add(event.pointerId); interrupt(); };
  const pointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId); interrupt(); };
  const keyDown = (event: KeyboardEvent) => { keys.add(event.code); interrupt(); };
  const keyUp = (event: KeyboardEvent) => { keys.delete(event.code); interrupt(); };
  const blur = () => { pointers.clear(); keys.clear(); interrupt(); };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame); window.clearTimeout(timer); window.clearTimeout(feedbackTimer);
    worker?.terminate();
    stream?.getTracks().forEach(track => { track.removeEventListener("ended", cameraEnded); track.stop(); });
    if (stream) options.onActiveChange?.(false);
    video.pause(); video.srcObject = null;
    window.removeEventListener("pointerdown", pointerDown); window.removeEventListener("pointerup", pointerUp);
    window.removeEventListener("pointercancel", pointerUp); window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", keyUp); window.removeEventListener("wheel", interrupt);
    window.removeEventListener("blur", blur);
  };
  const fail = (error: HandCameraError) => {
    if (disposed) return;
    cleanup(); options.onError(error);
  };
  const cameraEnded = () => fail("camera");
  const blocked = () => document.hidden || !document.hasFocus();
  const suspended = () => !options.allowed()
    || pointers.size > 0 || keys.size > 0 || performance.now() < manualUntil
    || !!document.querySelector(":popover-open:not([data-hand-visual])");
  const tick = async (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    if (blocked()) {
      if (!paused) {
        paused = true; worker?.postMessage({ type: "reset" }); window.clearTimeout(feedbackTimer);
        options.onResult({ ...emptyHandFeedback, mode: "paused" });
      }
      return;
    }
    paused = false;
    const nextSuspended = suspended();
    if (lastSuspended !== undefined && lastSuspended !== nextSuspended) worker?.postMessage({ type: "reset" });
    lastSuspended = nextSuspended;
    if (!ready || busy || now - lastCapture < 1000 / 30 || video.readyState < 2 || video.currentTime === lastVideoTime) return;
    busy = true; lastCapture = now; lastVideoTime = video.currentTime;
    try {
      const image = await createImageBitmap(video);
      if (disposed) { image.close(); return; }
      if (blocked()) { image.close(); busy = false; return; }
      try {
        worker!.postMessage({ type: "frame", image, timestamp: now, aspect: video.videoWidth / video.videoHeight, region: options.region(),
          cameraAllowed: options.cameraAllowed?.() ?? true, suspended: suspended() }, [image]);
      } catch (cause) { image.close(); throw cause; }
      timer = window.setTimeout(() => fail("processing"), 10000);
    } catch { fail("processing"); }
  };
  window.addEventListener("pointerdown", pointerDown); window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerUp); window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp); window.addEventListener("wheel", interrupt, { passive: true });
  window.addEventListener("blur", blur);
  void (async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof Worker === "undefined" || typeof createImageBitmap === "undefined") {
      fail("unsupported"); return;
    }
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : { facingMode: "user" }),
          width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
      });
      if (disposed) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      stream.getVideoTracks().forEach(track => track.addEventListener("ended", cameraEnded));
      options.onActiveChange?.(true);
      video.srcObject = stream;
      await video.play();
    } catch { fail("camera"); return; }
    if (disposed) return;
    options.onStarted?.();
    try {
      worker = new Worker(new URL("./hand-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        if (disposed) return;
        window.clearTimeout(timer);
        if (data.type === "error") { fail(data.stage); return; }
        if (data.type === "ready") {
          ready = true; options.onResult(emptyHandFeedback); frame = requestAnimationFrame(tick);
        } else if (data.type === "result") {
          busy = false;
          window.clearTimeout(feedbackTimer);
          if (performance.now() - data.timestamp > 200) {
            worker?.postMessage({ type: "reset" }); options.onResult(emptyHandFeedback);
          } else if (!blocked()) {
            const cameraAllowed = options.cameraAllowed?.() ?? true;
            const isSuspended = suspended();
            const changed = data.cameraAllowed !== undefined && data.cameraAllowed !== cameraAllowed
              || data.suspended !== undefined && data.suspended !== isSuspended;
            if (changed) worker?.postMessage({ type: "reset" });
            options.onResult(changed || isSuspended ? { ...data, mode: "paused", commands: [], zoom: "none" }
              : !cameraAllowed ? { ...data, mode: "idle", commands: [], zoom: "none" } : data);
            if (data.hands.length) feedbackTimer = window.setTimeout(() => {
              worker?.postMessage({ type: "reset" }); options.onResult(emptyHandFeedback);
            }, 250);
          }
        }
      };
      worker.onerror = () => fail(ready ? "processing" : "model");
      worker.onmessageerror = () => fail("processing");
      worker.postMessage({ type: "init", modelUrl: new URL(`${import.meta.env.BASE_URL}hand-input/hand_landmarker.task`, window.location.href).href });
      timer = window.setTimeout(() => fail("model"), 30000);
    } catch { fail("model"); }
  })();
  return cleanup;
}
