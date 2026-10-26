import { HandLandmarker } from "@mediapipe/tasks-vision";
import loaderUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import binaryUrl from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import init, { HandGestureController } from "../../wasm/wasm";

let landmarker: HandLandmarker;
let gestures: HandGestureController;

self.onmessage = async ({ data }: MessageEvent<
  | { type: "init"; modelUrl: string }
  | { type: "reset" }
  | { type: "frame"; image: ImageBitmap; timestamp: number; aspect: number; region: number[]; cameraAllowed: boolean; suspended: boolean }
>) => {
  try {
    if (data.type === "init") {
      await init();
      gestures = new HandGestureController();
      landmarker = await HandLandmarker.createFromOptions({
        wasmLoaderPath: new URL(loaderUrl, self.location.href).href,
        wasmBinaryPath: new URL(binaryUrl, self.location.href).href,
      }, {
        baseOptions: { modelAssetPath: data.modelUrl, delegate: "CPU" },
        runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      });
      self.postMessage({ type: "ready" });
    } else if (data.type === "reset") {
      gestures?.cancel_controls();
    } else {
      try {
        const result = landmarker.detectForVideo(data.image, data.timestamp);
        const hands = result.landmarks.flatMap((points, index) => {
          const side = result.handedness[index]?.[0];
          return [side?.categoryName === "Left" ? 0 : side?.categoryName === "Right" ? 1 : -1,
            side?.score ?? 0, ...points.flatMap(point => [point.x, point.y, point.z])];
        });
        gestures.set_suspended(data.suspended);
        const update = JSON.parse(gestures.update_controls(new Float32Array(hands), data.timestamp, data.aspect, new Float32Array(data.region), data.cameraAllowed));
        self.postMessage({ type: "result", timestamp: data.timestamp, region: data.region,
          cameraAllowed: data.cameraAllowed, suspended: data.suspended, ...update });
      } finally {
        data.image.close();
      }
    }
  } catch (cause) {
    self.postMessage({ type: "error", stage: data.type === "init" ? "model" : "processing" });
    console.error("Hand camera worker failed", cause);
  }
};
