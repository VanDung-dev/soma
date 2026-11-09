import type { Language } from "../i18n";
import { useLanguage } from "../i18n";
import type { LessonQuestion } from "./contract";
import { newLessonId } from "./source";

export function newLessonQuestion(): LessonQuestion {
  return { id: newLessonId(), prompt: { vi: "", en: "" }, explanation: { vi: "", en: "" }, answerId: "",
    choices: Array.from({ length: 2 }, () => ({ id: newLessonId(), text: { vi: "", en: "" } })) };
}

export function LessonQuestionEditor({ questions, locale, onChange }: {
  questions: LessonQuestion[];
  locale: Language;
  onChange: (questions: LessonQuestion[]) => void;
}) {
  const { t } = useLanguage();
  const update = (value: LessonQuestion) => onChange(questions.map(question => question.id === value.id ? value : question));
  return <section className="lesson-question-editor lesson-fields" aria-label={t("lessons.questions")}>
    {questions.map((question, index) => <fieldset className="lesson-question" key={question.id}>
      <legend>{t("lessons.questionNumber", { number: index + 1 })}</legend>
      <label className="lesson-question-prompt">{t("lessons.questionPrompt")}
        <textarea value={question.prompt[locale]} lang={locale} onChange={event => update({ ...question,
          prompt: { ...question.prompt, [locale]: event.target.value } })} />
      </label>
      <fieldset className="lesson-question-choices">
        <legend>{t("lessons.correctAnswer")}</legend>
        {question.choices.map((choice, choiceIndex) => <div className="lesson-question-choice" key={choice.id}>
          <input type="radio" name={`answer-${question.id}`} checked={question.answerId === choice.id}
            aria-label={t("lessons.markCorrect", { number: choiceIndex + 1 })}
            onChange={() => update({ ...question, answerId: choice.id })} />
          <input value={choice.text[locale]} lang={locale} aria-label={t("lessons.choiceNumber", { number: choiceIndex + 1 })}
            onChange={event => update({ ...question, choices: question.choices.map(value => value.id === choice.id
              ? { ...value, text: { ...value.text, [locale]: event.target.value } } : value) })} />
          <button className="lesson-button" onClick={() => update({ ...question, choices: question.choices.filter(value => value.id !== choice.id),
            answerId: question.answerId === choice.id ? "" : question.answerId })}>{t("lessons.removeChoice")}</button>
        </div>)}
      </fieldset>
      <button className="lesson-button" onClick={() => update({ ...question,
        choices: [...question.choices, { id: newLessonId(), text: { vi: "", en: "" } }] })}>{t("lessons.addAnswer")}</button>
      <label className="lesson-question-explanation">{t("lessons.explanation")}
        <textarea value={question.explanation[locale]} lang={locale} onChange={event => update({ ...question,
          explanation: { ...question.explanation, [locale]: event.target.value } })} />
      </label>
      <button className="lesson-button" onClick={() => {
        if (window.confirm(t("lessons.confirmRemoveQuestion"))) onChange(questions.filter(value => value.id !== question.id));
      }}>{t("lessons.removeQuestion")}</button>
    </fieldset>)}
    <button className="lesson-button" onClick={() => onChange([...questions, newLessonQuestion()])}>{t("lessons.addQuestion")}</button>
  </section>;
}
