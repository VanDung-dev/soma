import type { Language } from "../../i18n";
import { translateMessage, useLanguage } from "../../i18n";
import type { Lesson } from "../shared/contract";
import { lessonPlainText } from "../shared/rich-text";
import { LessonCoverEditor } from "./cover-editor";

export function LessonDetails({ lesson, language, onChange }: {
  lesson: Lesson;
  language: Language;
  onChange: (patch: Partial<Lesson>) => void;
}) {
  const { t } = useLanguage();

  const currentLanguages = lesson.languages && lesson.languages.length > 0 ? lesson.languages : ["vi", "en"];
  const languageChoice = currentLanguages.length >= 2 ? "both" : currentLanguages[0];

  function handleLanguageChange(value: "both" | "vi" | "en") {
    if (value === "both") {
      onChange({ languages: ["vi", "en"] });
    } else {
      onChange({ languages: [value] });
    }
  }

  const summary = lesson.summary.html?.includes(language)
    ? lessonPlainText({ vi: "", en: "", html: [language], [language]: lesson.summary[language] }, language)
    : lesson.summary[language];

  return <div className="lesson-details-form">
    <div className="lesson-language-selector" id="lesson-language-select" role="group" aria-label={t("lessons.languages")}>
      <span className="lesson-details-label">{t("lessons.languages")}</span>
      <div className="lesson-language-options">
        <button
          type="button"
          className="lesson-button"
          aria-pressed={languageChoice === "both"}
          onClick={() => handleLanguageChange("both")}
        >
          {t("lessons.languagesBoth")}
        </button>
        <button
          type="button"
          className="lesson-button"
          aria-pressed={languageChoice === "vi"}
          onClick={() => handleLanguageChange("vi")}
        >
          {t("lessons.languagesVi")}
        </button>
        <button
          type="button"
          className="lesson-button"
          aria-pressed={languageChoice === "en"}
          onClick={() => handleLanguageChange("en")}
        >
          {t("lessons.languagesEn")}
        </button>
      </div>
    </div>
    <label htmlFor="lesson-author">{t("lessons.author")}
      <input id="lesson-author" type="text" value={lesson.author ?? ""}
        onChange={event => onChange({ author: event.target.value || undefined })} />
    </label>
    <label htmlFor="lesson-write-summary" lang={language}>{translateMessage("lessons.summary", language)}
      <textarea id="lesson-write-summary" rows={4} lang={language} value={summary} onChange={event => {
        const html = lesson.summary.html?.filter(locale => locale !== language);
        onChange({ summary: { ...lesson.summary, [language]: event.target.value, html: html?.length ? html : undefined } });
      }} />
    </label>
    <div className="lesson-details-cover">
      <span className="lesson-details-label">{t("lessons.cover")}</span>
      <LessonCoverEditor lesson={lesson} onChange={onChange} />
    </div>
  </div>;
}
