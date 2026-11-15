import type { LessonScene, LessonStep } from "../shared/contract";

export function restoreSavedScene(step: LessonStep, scene: LessonScene | undefined, modelIds: string[]): LessonStep {
  const patch = { modelIds, targetId: scene?.targetId ?? "", visibleIds: scene?.visibleIds, view: scene?.view };
  return step.kind === "identify_structure" ? { ...step, ...patch } : { ...step, kind: "observe", ...patch };
}
