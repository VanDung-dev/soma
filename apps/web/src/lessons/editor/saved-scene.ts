import type { LessonScene, LessonStep } from "../shared/contract";
import { lessonSceneFields } from "../shared/contract";

export function restoreSavedScene(step: LessonStep, scene: LessonScene | undefined, modelIds: string[]): LessonStep {
  return { ...step, kind: "observe", ...lessonSceneFields(scene, modelIds) };
}
