import { useState } from "react";
import { useLanguage } from "../i18n";
import type { LessonQuestion } from "./contract";
import { lessonText } from "./contract";
import { lessonHtml } from "./rich-text";
import { useLessonImages } from "./image-context";

type Answer = { selected: string; correct: boolean; checked: boolean };

export function LessonQuestions({ stepId, questions, disabled, onComplete }: {
  stepId: string;
  questions: LessonQuestion[];
  disabled: boolean;
  onComplete: () => void;
}) {
  const { language, t } = useLanguage();
  const images = useLessonImages();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  return <div className="lesson-questions">
    {questions.map((question, index) => {
      const key = `${stepId}/${question.id}`;
      const answer = answers[key];
      return <section className="lesson-question" key={key} aria-label={t("lessons.questionNumber", { number: index + 1 })}>
        <fieldset className="lesson-choices" disabled={disabled || answer?.correct}>
          <legend>{lessonText(question.prompt, language) || t("lessons.questionNumber", { number: index + 1 })}</legend>
          {question.choices.map(choice => <label key={choice.id}>
            <input type="radio" name={key} checked={answer?.selected === choice.id} onChange={() => setAnswers(current => ({
              ...current, [key]: { selected: choice.id, correct: false, checked: false },
            }))} />
            {lessonText(choice.text, language)}
          </label>)}
        </fieldset>
        {!answer?.correct && <button className="lesson-button lesson-primary" disabled={disabled || !answer?.selected}
          onClick={() => {
            const correct = answer?.selected === question.answerId;
            const next = { ...answers, [key]: { selected: answer!.selected, correct, checked: true } };
            setAnswers(next);
            if (questions.length && questions.every(value => next[`${stepId}/${value.id}`]?.correct)) onComplete();
          }}>{t("lessons.check")}</button>}
        <div className="lesson-feedback" role="status">
          {answer?.checked && <p>{t(answer.correct ? "lessons.correct" : "lessons.incorrect")}</p>}
          {answer?.correct && <div className="lesson-rich-content" dangerouslySetInnerHTML={{ __html: lessonHtml(question.explanation, language, images.urls) }} />}
        </div>
      </section>;
    })}
  </div>;
}
