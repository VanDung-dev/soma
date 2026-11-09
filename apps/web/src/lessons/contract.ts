import * as content from "../content/content.js";
import type { SceneView } from "../anatomy/viewer/contracts";

export type LessonText = { vi: string; en: string; html?: ("vi" | "en")[] };
export type LessonMode = "content" | "questions" | "content_questions";
export type LessonQuestion = {
  id: string;
  prompt: LessonText;
  choices: { id: string; text: LessonText }[];
  answerId: string;
  explanation: LessonText;
};

type StepContent = { id: string; title: LessonText; instruction: LessonText; showModel?: boolean; mode?: LessonMode; questions?: LessonQuestion[] };
export type LessonScene = { targetId: string; visibleIds?: string[]; view?: SceneView };
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
  cover?: string;
  modelId: string;
  modelIds?: string[];
  scene?: LessonScene;
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

export function lessonMode(step: LessonStep): LessonMode {
  return step.mode ?? (step.kind === "identify_structure" || step.questions?.length ? "content_questions" : "content");
}

export function lessonQuestions(step: LessonStep, names: (id: string) => { vi: string; en: string } | undefined): LessonQuestion[] {
  if (step.questions) return step.questions;
  return step.kind === "identify_structure" ? [{ id: step.id, prompt: step.title, answerId: step.answerId,
    explanation: step.explanation, choices: step.choiceIds.map(id => ({ id, text: names(id) ?? { vi: id, en: id } })) }] : [];
}

export function updateLessonQuestions(step: LessonStep, mode: LessonMode, questions: LessonQuestion[]): LessonStep {
  if (step.kind !== "identify_structure") return { ...step, mode, questions };
  const { choiceIds, answerId, explanation, ...base } = step;
  return { ...base, kind: "observe", mode, questions };
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
