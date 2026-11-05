export type LessonText = { vi: string; en: string };

type StepContent = { id: string; title: LessonText; instruction: LessonText };
type LessonScene = { targetId: string; visibleIds?: string[] };
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

export function lessonText(value: LessonText, language: keyof LessonText) {
  return value[language].trim() || value[language === "vi" ? "en" : "vi"].trim();
}

const slug = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
function localized(value: unknown, required: boolean) {
  return object(value) && string(value.vi) && string(value.en) && (!required || !!(value.vi.trim() || value.en.trim()));
}

export function readLesson(value: unknown, draft = false): Lesson {
  if (!object(value) || !slug(value.id) || !Number.isSafeInteger(value.version)
    || typeof value.version !== "number" || value.version < 1 || !localized(value.title, !draft)
    || !localized(value.summary, false) || !string(value.modelId) || !Array.isArray(value.steps)
    || (!draft && !value.steps.length)) {
    throw new LessonValidationError("details", "A lesson needs a title and at least one step.");
  }
  const ids = new Set<string>();
  for (const [index, step] of value.steps.entries()) {
    const label = `Step ${index + 1}`;
    if (!object(step) || !slug(step.id) || ids.has(step.id) || !localized(step.title, !draft) || !localized(step.instruction, !draft)) {
      throw new LessonValidationError("stepText", `${label} needs a title and instructions.`, index + 1);
    }
    if (step.kind !== "text" && (!string(step.targetId) || (!draft && (!value.modelId || !step.targetId))
      || step.visibleIds !== undefined && (!Array.isArray(step.visibleIds) || !step.visibleIds.every(string)
        || new Set(step.visibleIds).size !== step.visibleIds.length))) {
      throw new LessonValidationError("target", `${label} needs a model and a structure.`, index + 1);
    }
    if (step.kind !== "text" && step.kind !== "observe" && (step.kind !== "identify_structure" || !Array.isArray(step.choiceIds)
      || !step.choiceIds.every(string) || new Set(step.choiceIds).size !== step.choiceIds.length || !string(step.answerId)
      || !localized(step.explanation, false) || (!draft && (step.choiceIds.length < 2 || !step.choiceIds.includes(step.answerId))))) {
      throw new LessonValidationError("choices", `${label} needs at least two choices and a correct answer.`, index + 1);
    }
    ids.add(step.id);
  }
  return value as Lesson;
}

export function validateLessonTargets(lesson: Lesson, structureIds: readonly string[], members: (id: string) => readonly string[]) {
  const model = new Set(structureIds);
  for (const [index, step] of lesson.steps.entries()) {
    if (step.kind === "text") continue;
    const target = members(step.targetId);
    const scene = step.visibleIds ?? target;
    if (!target.length || !target.every(id => model.has(id)) || !scene.length || !scene.every(id => model.has(id))) {
      throw new LessonValidationError("scope", `Step ${index + 1}: unavailable structure.`, index + 1);
    }
    if (step.kind !== "identify_structure") continue;
    const visible = new Set(scene);
    const choices = new Set<string>();
    for (const choiceId of step.choiceIds) {
      const choice = members(choiceId);
      if (!choice.length || !choice.every(id => visible.has(id) && !choices.has(id))) {
        throw new LessonValidationError("overlap", `Step ${index + 1}: choices must be visible and cannot overlap.`, index + 1);
      }
      choice.forEach(id => choices.add(id));
    }
  }
}
