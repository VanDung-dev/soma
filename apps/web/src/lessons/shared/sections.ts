import type { Language } from "../../i18n";
import { lessonSceneStep, lessonText } from "./contract";
import type { Lesson, LessonScene, LessonStep } from "./contract";

export type LessonWorkspaceMode = "edit" | "preview" | "view";
export type LessonReaderMode = Exclude<LessonWorkspaceMode, "edit">;

export function findLessonSection(steps: readonly LessonStep[], id: string | null | undefined) {
  return steps.findIndex(step => step.id === id);
}

export function lessonSectionAt(steps: readonly LessonStep[], index: number) {
  return {
    step: steps[index], previous: steps[index - 1], next: steps[index + 1],
    position: { current: index + 1, total: steps.length },
  };
}

export function lessonSectionTitle(step: LessonStep, language: Language, untitled: string, fallback = true) {
  return lessonText(step.title, language, fallback) || untitled;
}

export function resolveLessonSectionScene(lesson: Lesson, index: number, mode: LessonReaderMode): ReturnType<typeof lessonSceneStep>;
export function resolveLessonSectionScene(lesson: Lesson, index: number, mode: "edit"): LessonScene | undefined;
export function resolveLessonSectionScene(lesson: Lesson, index: number, mode: LessonWorkspaceMode) {
  if (mode !== "edit") return lessonSceneStep(lesson, index);
  const step = lesson.steps[index];
  if (step && step.kind !== "text") return step;
  const modelId = lesson.modelIds?.[0] || lesson.modelId;
  return lessonSceneStep(lesson, Math.max(0, index)) ?? lesson.scene ?? (modelId ? { targetId: modelId } : undefined);
}
