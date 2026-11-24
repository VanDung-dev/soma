import * as content from "../../content/content.js";
import type { SceneView } from "../../anatomy/viewer/contracts";

export const LESSON_STORAGE_PREFIX = "soma.lesson-v1:";

export type LessonText = { vi: string; en: string; html?: ("vi" | "en")[] };
export type LessonMode = "content" | "questions" | "content_questions";
export type LessonQuestion = {
  id: string;
  prompt: LessonText;
  choices: { id: string; text: LessonText }[];
  answerId: string;
  explanation: LessonText;
};

type StepContent = { id: string; title: LessonText; instruction: LessonText; showModel?: boolean; mode?: LessonMode; questions?: LessonQuestion[]; sceneRef?: string; questionRef?: string };
export type LessonScene = { modelIds?: string[]; targetId: string; visibleIds?: string[]; view?: SceneView };
export type LessonStep = StepContent & ({ kind: "text" } | LessonScene & { kind: "observe" });
export type LessonCoverCrop = { zoom: number; x: number; y: number };
export type Lesson = {
  id: string;
  version: number;
  createdAt?: number;
  updatedAt?: number;
  title: LessonText;
  summary: LessonText;
  author?: string;
  cover?: string;
  coverCrop?: LessonCoverCrop;
  modelId: string;
  modelIds?: string[];
  preloadModelIds?: string[];
  scene?: LessonScene;
  sceneRef?: string;
  steps: LessonStep[];
  languages?: ("vi" | "en")[];
};

type ValidationReason = "details" | "stepText" | "target" | "choices" | "scope";
export class LessonValidationError extends Error {
  readonly reason: ValidationReason;
  readonly step: number;

  constructor(reason: ValidationReason, message: string, step = 0) {
    super(message);
    this.reason = reason;
    this.step = step;
  }
}

export function lessonText(value: LessonText, language: "vi" | "en", fallback = true) {
  return value[language].trim() || (fallback ? value[language === "vi" ? "en" : "vi"].trim() : "");
}

export function lessonLanguageTag(lesson: Lesson): "vi" | "en" | "vi/en" {
  const first = lesson.languages?.[0];
  if (first && lesson.languages?.length === 1) {
    return first;
  }
  if (lesson.languages && lesson.languages.length >= 2) {
    return "vi/en";
  }
  const hasVi = Boolean(lesson.title.vi?.trim() || lesson.summary.vi?.trim());
  const hasEn = Boolean(lesson.title.en?.trim() || lesson.summary.en?.trim());
  if (hasVi && !hasEn) return "vi";
  if (hasEn && !hasVi) return "en";
  return "vi/en";
}

export function lessonMode(step: LessonStep): LessonMode {
  return step.mode ?? (step.questions?.length ? "content_questions" : "content");
}

export function updateLessonQuestions(step: LessonStep, mode: LessonMode, questions: LessonQuestion[]): LessonStep {
  return { ...step, mode, questions, questionRef: undefined };
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
  const ids = new Set([
    ...lesson.steps.flatMap(step => step.kind === "text" ? [] : [step.targetId, ...(step.modelIds ?? [])]),
    ...(lesson.scene?.modelIds ?? []), ...(lesson.modelIds ?? []), lesson.modelId,
  ]);
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
