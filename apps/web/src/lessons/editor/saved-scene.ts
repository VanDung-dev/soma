import type { LessonScene, LessonStep } from "../shared/contract";

export function restoreSavedScene(step: LessonStep, scene: LessonScene | undefined, modelIds: string[]): LessonStep {
  const patch = { modelIds, targetId: scene?.targetId ?? "", visibleIds: scene?.visibleIds, view: scene?.view,
    sceneRef: scene && "sceneRef" in scene && typeof scene.sceneRef === "string" ? scene.sceneRef : undefined };
  return { ...step, kind: "observe", ...patch };
}
