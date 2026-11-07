import * as content from "../content/content.js";
import type { SceneView } from "../anatomy/viewer/contracts";

export type LessonText = { vi: string; en: string; html?: ("vi" | "en")[] };

type StepContent = { id: string; title: LessonText; instruction: LessonText };
type LessonScene = { targetId: string; visibleIds?: string[]; view?: SceneView };
export type LessonStep = StepContent & ({ kind: "text" } | LessonScene & { kind: "observe" } | LessonScene & {
  kind: "identify_structure";
  choiceIds: string[];
  answerId: string;
  explanation: LessonText;
});
export type Lesson = {
  id: string;
  version: number;
  title: LessonText;
  summary: LessonText;
  modelId: string;
  steps: LessonStep[];
};

type ValidationReason = "details" | "stepText" | "target" | "choices" | "scope" | "overlap";
export class LessonValidationError extends Error {
  readonly reason: ValidationReason;
  readonly step: number;

  constructor(reason: ValidationReason, message: string, step = 0) {
    super(message);
    this.reason = reason;
    this.step = step;
  }
}

export function lessonText(value: LessonText, language: "vi" | "en") {
  return value[language].trim() || value[language === "vi" ? "en" : "vi"].trim();
}

export function lessonSceneStep(lesson: Lesson, index: number) {
  return lesson.steps[content.lesson_scene_index(JSON.stringify(lesson), index)] as Exclude<LessonStep, { kind: "text" }> | undefined;
}

function validation(action: () => void) {
  try { action(); }
  catch (cause) {
    if (cause && typeof cause === "object" && "reason" in cause) {
      const error = cause as { reason: ValidationReason; message: string; step: number };
      throw new LessonValidationError(error.reason, error.message, error.step);
    }
    throw cause;
  }
}

export function readLesson(value: unknown, draft = false): Lesson {
  validation(() => content.validate_lesson(JSON.stringify(value) ?? "null", draft));
  return value as Lesson;
}

function membership(lesson: Lesson, members: (id: string) => readonly string[]) {
  const ids = new Set(lesson.steps.flatMap(step => step.kind === "text" ? [] : [step.targetId,
    ...(step.kind === "identify_structure" ? step.choiceIds : [])]));
  return Object.fromEntries([...ids].map(id => [id, members(id)]));
}

export function validateLessonTargets(lesson: Lesson, structureIds: readonly string[], members: (id: string) => readonly string[]) {
  validation(() => content.lesson_targets(JSON.stringify(lesson), structureIds, membership(lesson, members)));
}

export function lessonPreviewIssues(lesson: Lesson, structureIds: readonly string[], members: (id: string) => readonly string[]) {
  const issues = content.lesson_preview_issues(JSON.stringify(lesson), structureIds, membership(lesson, members)) as
    [string, { reason: ValidationReason; message: string; step: number }][];
  return new Map(issues.map(([id, error]) => [id, new LessonValidationError(error.reason, error.message, error.step)]));
}
