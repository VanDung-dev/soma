import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Ref } from "react";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";
import { AlertCard } from "../pages/alert-card";
import { LessonCover } from "./editor/cover";
import type { Lesson } from "./shared/contract";
import { lessonLanguageTag, lessonText } from "./shared/contract";
import { lessonPlainText } from "./shared/rich-text";
import "./library.css";

const searchable = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");

export function LessonLibrary({ lessons, loading, saving, importing, error, exportingId, titleRef, dragging, onDraggingChange, onCreate, onImport, onStart, onEdit, onExport, onRemove }: {
  lessons: Lesson[]; loading: boolean; saving: boolean; importing: boolean; error?: string; exportingId?: string; titleRef: Ref<HTMLHeadingElement>;
  dragging: boolean; onDraggingChange: (dragging: boolean) => void;
  onCreate: () => void; onImport: (file: File) => Promise<Lesson | undefined>; onStart: (lesson: Lesson) => void;
  onEdit: (lesson: Lesson) => void; onExport: (lesson: Lesson) => void; onRemove: (lesson: Lesson) => void;
}) {
  const { language, t } = useLanguage();
  const picker = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [fileError, setFileError] = useState("");
  const [notice, setNotice] = useState("");
  const busy = loading || saving || importing;
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  const matching = !terms.length ? lessons : lessons.filter(lesson => {
    const content = searchable([lesson.title.vi, lesson.title.en, lesson.author ?? "", lessonPlainText(lesson.summary, "vi"), lessonPlainText(lesson.summary, "en"),
      lessonText(lesson.title, language) || t("lessons.untitled")].join(" "));
    return terms.every(term => content.includes(term));
  });
  async function receiveFiles(files: File[]) {
    if (busy) return;
    setNotice("");
    if (files.length !== 1 || !/\.(lesson|soma)\.br$/i.test(files[0]!.name)) {
      setFileError(t("lessons.importFileError"));
      return;
    }
    setFileError("");
    const lesson = await onImport(files[0]!);
    if (lesson) {
      setQuery("");
      setNotice(t("lessons.imported", { name: lessonText(lesson.title, language) || t("lessons.untitled") }));
    }
  }
  const dropFiles = useEffectEvent((files: File[]) => { void receiveFiles(files); });
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      onDraggingChange(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) onDraggingChange(false);
    };
    const reset = () => { depth = 0; onDraggingChange(false); };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      reset();
      dropFiles(Array.from(event.dataTransfer!.files));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("blur", reset);
    window.addEventListener("dragend", reset);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("blur", reset);
      window.removeEventListener("dragend", reset);
    };
  }, []);

  return <section className="lesson-library-page" aria-labelledby="lesson-library-title" data-dragging={dragging}>
    <header className="lesson-library-header">
      <div className="lesson-library-intro">
        <span className="lesson-library-eyebrow">SOMA / LESSONS</span>
        <h1 id="lesson-library-title" ref={titleRef} tabIndex={-1}>{t("lessons.libraryTitle")}</h1>
        <p>{t("home.lessons.description")}</p>
        <div className="lesson-library-actions">
          <button type="button" className="lesson-button lesson-primary" disabled={busy} onClick={onCreate}>
            <span aria-hidden="true">+</span>{t("lessons.create")}
          </button>
          <span className="lesson-library-total">{t("lessons.lessonCount", { count: lessons.length })}</span>
        </div>
      </div>
      <button type="button" className="lesson-import-zone" disabled={busy} onClick={() => picker.current?.click()} aria-label={t("lessons.import")}>
        <span className="lesson-import-file-icon" aria-hidden="true">
          <svg width="24" height="28" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H5a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z" /><path d="M14 2v7h7M12 13v8m-3-3 3 3 3-3" />
          </svg>
        </span>
        <span><strong>{t(importing ? "lessons.importing" : "lessons.import")}</strong><small>{t("lessons.dropOrChoose")}</small></span>
        <span className="lesson-import-open" aria-hidden="true"><LineIcon name="arrow-small-right" size={18} /></span>
      </button>
      <input ref={picker} className="sr-only" type="file" accept=".lesson.br,.soma.br" disabled={busy} tabIndex={-1}
        aria-label={t("lessons.import")} onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) void receiveFiles(files);
        }} />
    </header>
    <div className="lesson-library-toolbar">
      <div><h2>{t("lessons.yourLessons")}</h2><span>{t("lessons.lessonCount", { count: matching.length })}</span></div>
      <label className="lesson-library-search">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <span className="sr-only">{t("lessons.searchLessons")}</span>
        <input type="search" value={query} placeholder={t("lessons.searchLessons")} onChange={event => setQuery(event.target.value)} />
      </label>
    </div>
    {fileError && <AlertCard title={language === "vi" ? "Thông báo" : "Notice"} message={fileError}
      onCancel={() => setFileError("")} actions={[{ label: language === "vi" ? "Đóng" : "Close", onClick: () => setFileError("") }]} />}
    {error && !fileError && <p className="lesson-library-error" role="alert"><LineIcon name="alert-circle" size={18} /><span>{error}</span></p>}
    <div className="lesson-library-status" role="status" aria-live="polite">
      {importing ? <><progress aria-label={t("lessons.importing")} />{t("lessons.importing")}</> : notice}
    </div>
    {loading ? <p role="status">{t("lessons.loading")}</p> : !matching.length ? <div className="lesson-library-empty" role="status">
      <span className="lesson-empty-mark" aria-hidden="true">{lessons.length ? "⌕" : "+"}</span>
      <h3>{t(lessons.length ? "lessons.noLessonMatches" : "lessons.empty")}</h3>
      <p>{t(lessons.length ? "lessons.searchHint" : "lessons.emptyHint")}</p>
      {lessons.length > 0 && <button type="button" className="lesson-button" onClick={() => setQuery("")}>{t("lessons.clearSearch")}</button>}
    </div> : <ul className="lesson-library">
      {matching.map((lesson, index) => {
        const tag = lessonLanguageTag(lesson).replace("/", " / ").toUpperCase();
        const name = lessonText(lesson.title, language) || t("lessons.untitled");
        const badge = <span className="lesson-cover-badge" aria-label={`${t("lessons.languages")}: ${tag}`}>{tag}</span>;
        return <li className="lesson-card" key={lesson.id}>
          {lesson.cover ? <LessonCover lesson={lesson}>{badge}</LessonCover> : <div className="lesson-cover lesson-cover-empty">
            <span className="lesson-card-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{badge}
          </div>}
          <div className="lesson-card-content">
            <span className="lesson-card-meta">{t("lessons.sectionCount", { count: lesson.steps.length })}</span>
            <h3>{name}</h3>
            {lesson.author?.trim() && <p className="lesson-card-author">{t("lessons.author")}: {lesson.author}</p>}
            <p className="lesson-card-summary">{lessonPlainText(lesson.summary, language) || t("lessons.noDescription")}</p>
            <div className="lesson-card-actions">
              <button type="button" className="lesson-button lesson-primary" onClick={() => onStart(lesson)}>{t("lessons.start")}<LineIcon name="arrow-small-right" /></button>
              <button type="button" className="lesson-button" onClick={() => onEdit(lesson)}>{t("lessons.edit")}</button>
              <button type="button" className="controls-info lesson-card-export" disabled={exportingId === lesson.id} aria-busy={exportingId === lesson.id}
                aria-label={t("lessons.export")} title={`${t("lessons.export")}: ${name}`} onClick={() => onExport(lesson)}><LineIcon name="arrow-small-right" /></button>
              <button type="button" className="controls-info lesson-card-delete" aria-label={t("lessons.remove")} title={`${t("lessons.remove")}: ${name}`} onClick={() => onRemove(lesson)}><LineIcon name="close-small" /></button>
            </div>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
