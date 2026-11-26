import { useMemo, useState } from "react";
import { useLanguage } from "../../i18n";
import type { Language } from "../../i18n";
import type { LessonQuestion, LessonText } from "../shared/contract";
import { lessonText } from "../shared/contract";
import { lessonHtml } from "../shared/rich-text";
import { useLessonImages } from "../shared/image-context";

type Answer = { selected: string; checked: boolean };

export function LessonQuestions({ stepId, questions, previewLocale, disabled, correctQuestions, onAnswer }: {
  stepId: string;
  questions: LessonQuestion[];
  previewLocale?: Language;
  disabled: boolean;
  correctQuestions: readonly string[];
  onAnswer: (questionId: string, answerId: string, choiceId: string) => boolean;
}) {
  const { language, t } = useLanguage();
  const contentLanguage = previewLocale ?? language;
  const readText = (value: LessonText) => lessonText(value, contentLanguage, previewLocale === undefined);
  const images = useLessonImages();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const correctIds = useMemo(() => new Set(correctQuestions), [correctQuestions]);
  return <div className="lesson-questions">
    {questions.map((question, index) => {
      const key = `${stepId}/${question.id}`;
      const correct = correctIds.has(question.id);
      const answer = correct ? { selected: question.answerId, checked: true } : answers[key];
      return <section className="lesson-question" key={key} aria-label={t("lessons.questionNumber", { number: index + 1 })}>
        <fieldset className="lesson-choices" disabled={disabled || correct}>
          <legend>{readText(question.prompt) || t("lessons.questionNumber", { number: index + 1 })}</legend>
          {question.choices.map(choice => <label key={choice.id}>
            <input type="radio" name={key} checked={answer?.selected === choice.id} onChange={() => setAnswers(current => ({
              ...current, [key]: { selected: choice.id, checked: false },
            }))} />
            {readText(choice.text)}
          </label>)}
        </fieldset>
        {!correct && <button className="lesson-button lesson-primary" disabled={disabled || !answer?.selected}
          onClick={() => {
            const selected = answer?.selected;
            if (!selected) return;
            if (!onAnswer(question.id, question.answerId, selected)) setAnswers(current => ({ ...current, [key]: { selected, checked: true } }));
          }}>{t("lessons.check")}</button>}
        <div className="lesson-feedback" role="status">
          {answer?.checked && <p>{t(correct ? "lessons.correct" : "lessons.incorrect")}</p>}
          {correct && <div className="lesson-rich-content" dangerouslySetInnerHTML={{ __html: lessonHtml(question.explanation, contentLanguage, images.urls, previewLocale === undefined) }} />}
        </div>
      </section>;
    })}
  </div>;
}
