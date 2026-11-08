import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Language } from "../i18n";
import { useLanguage } from "../i18n";
import type { Lesson } from "./contract";
import { useLessonImages } from "./image-context";
import { lessonPlainText } from "./rich-text";

export function LessonDetails({ lesson, language, onChange }: {
  lesson: Lesson;
  language: Language;
  onChange: (patch: Partial<Lesson>) => void;
}) {
  const { t } = useLanguage();
  const images = useLessonImages();
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const saveCover = useEffectEvent((cover: string) => onChange({ cover }));
  const summary = lesson.summary.html?.includes(language)
    ? lessonPlainText({ vi: "", en: "", html: [language], [language]: lesson.summary[language] }, language)
    : lesson.summary[language];
  return <div className="lesson-details-form">
    <label>{t("lessons.summary")} ({language.toUpperCase()})
      <textarea id="lesson-write-summary" rows={4} lang={language} value={summary} onChange={event => {
        const html = lesson.summary.html?.filter(locale => locale !== language);
        onChange({ summary: { ...lesson.summary, [language]: event.target.value, html: html?.length ? html : undefined } });
      }} />
    </label>
    <p className="lesson-document-hint">{t("lessons.cardDetailsHint")}</p>
    <div className="lesson-cover-editor">
      {lesson.cover && images.urls.has(lesson.cover) && <img className="lesson-cover" src={images.urls.get(lesson.cover)} alt={t("lessons.cover")} />}
      <label>{t("lessons.cover")}
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setUploading(true); setFailed(false);
          void images.add(file).then(url => {
            if (!active.current) return;
            const path = [...images.urls].find(([, value]) => value === url)?.[0];
            if (!path) throw new Error("Lesson cover was not stored");
            saveCover(path);
          }).catch(error => { if (active.current) { console.error("Lesson cover failed", error); setFailed(true); } })
            .finally(() => { if (active.current) setUploading(false); });
        }} />
      </label>
      {lesson.cover && <button className="lesson-button" disabled={uploading} onClick={() => onChange({ cover: undefined })}>{t("lessons.removeCover")}</button>}
      {uploading && <p role="status">{t("lessons.savingCover")}</p>}
      {failed && <p role="alert">{t("lessons.imageAddError")}</p>}
    </div>
  </div>;
}
