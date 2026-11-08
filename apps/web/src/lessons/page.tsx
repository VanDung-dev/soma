import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getCatalog, getContent } from "../anatomy/core";
import type { Catalog } from "../anatomy/catalog/types";
import { useLanguage } from "../i18n";
import { lessonText } from "./contract";
import type { Lesson } from "./contract";
import { emptyText, LessonEditor } from "./editor";
import { LessonPlayer } from "./player";
import { lessonEditPath } from "./routes";
import { importLesson, listLessons, newLessonId, removeLesson, saveLesson } from "./source";
import "./style.css";
import { lessonPlainText } from "./rich-text";
import { LessonImageProvider } from "./image-context";
import { storeLessonImages } from "./images";
import { LessonCover } from "./cover";

const searchable = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");

export function LessonsPage({ editId, navigate }: { editId?: string; navigate: (path: string) => void }) {
  const { language, t } = useLanguage();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [pending, setPending] = useState<Lesson>();
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<"load" | "save" | "import">();
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const lastSaved = useRef<Lesson>(undefined);

  useEffect(() => {
    let active = true;
    void getContent().then(() => { if (active) setLessons(listLessons()); })
      .catch(cause => { if (active) { console.error("Lesson library failed", cause); setError("load"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const draft = pending?.id === editId ? pending : lessons.find(item => item.id === editId);
  const editing = !!editId;
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  const matching = editing || !terms.length ? lessons : lessons.filter(lesson => {
    const content = searchable([lesson.title.vi, lesson.title.en, lessonPlainText(lesson.summary, "vi"), lessonPlainText(lesson.summary, "en"),
      lessonText(lesson.title, language) || t("lessons.untitled")].join(" "));
    return terms.every(term => content.includes(term));
  });
  useEffect(() => { setSelected(undefined); setPreview(false); }, [editId]);
  useEffect(() => { title.current?.focus(); }, [editing, preview]);

  function update(next: Lesson) {
    const previous = lastSaved.current?.id === next.id ? lastSaved.current : lessons.find(lesson => lesson.id === next.id);
    const revised = previous ? { ...next, version: previous.version + 1 } : next;
    try {
      saveLesson(revised, previous);
      lastSaved.current = revised;
      setLessons(current => previous ? current.map(lesson => lesson.id === revised.id ? revised : lesson) : [...current, revised]);
      setPending(undefined);
      setError(undefined);
      return true;
    } catch (cause) {
      console.error("Lesson draft save failed", cause);
      setPending(revised);
      setError("save");
      return false;
    }
  }

  function create() {
    const id = newLessonId();
    update({ id, version: 1, title: emptyText, summary: emptyText, modelId: "", steps: [] });
    navigate(lessonEditPath(id));
  }

  async function importFile(file: File) {
    setImporting(true);
    try {
      const { lesson, images } = await importLesson(file);
      const previous = lessons.find(item => item.id === lesson.id);
      if (previous && !window.confirm(t("lessons.confirmReplace", { name: lessonText(previous.title, language) || t("lessons.untitled") }))) return;
      if (images.size) await storeLessonImages(lesson.id, images);
      saveLesson(lesson, previous);
      lastSaved.current = lesson;
      setLessons(current => previous ? current.map(item => item.id === lesson.id ? lesson : item) : [...current, lesson]);
      setError(undefined);
    } catch (cause) {
      console.error("Lesson import failed", cause);
      setError("import");
    } finally { setImporting(false); }
  }

  function remove(lesson: Lesson) {
    if (!window.confirm(t("lessons.confirmRemove"))) return;
    try {
      removeLesson(lesson);
      if (lastSaved.current?.id === lesson.id) lastSaved.current = undefined;
      setLessons(current => current.filter(item => item.id !== lesson.id));
      setError(undefined);
    } catch (cause) {
      console.error("Lesson removal failed", cause);
      setError("save");
    }
  }

  function leave() {
    if (error === "save" && !window.confirm(t("lessons.confirmDiscard"))) return;
    setPending(undefined);
    setError(undefined);
    setPreview(false);
    navigate("/lessons");
  }

  return <main className="lessons-screen" data-editor={!!draft && !preview} data-player={!!draft && preview}>
    {draft ? <>
      <LessonImageProvider key={draft.id} lesson={draft}>
      <WithLessonCatalog key={`${draft.id}/${preview ? "preview" : "editor"}`}>{catalog => preview
        ? <LessonPlayer lesson={draft} catalog={catalog} preview onBack={leave} onEdit={() => setPreview(false)} />
        : <LessonEditor catalog={catalog} lesson={draft} selected={selected} onSelect={setSelected}
          saveFailed={error === "save"} onChange={update} onPreview={() => setPreview(true)}
          onBack={leave} />}
      </WithLessonCatalog>
      </LessonImageProvider>
    </> : editId ? <>
      <h1 ref={title} tabIndex={-1}>{t("module.lessons")}</h1>
      <p role={loading ? "status" : "alert"}>{t(loading ? "lessons.loading" : error === "load" ? "lessons.indexError" : "lessons.notFound")}</p>
      <button className="lesson-button" onClick={() => navigate("/lessons")}>{t("lessons.library")}</button>
    </> : <>
      <h1 ref={title} tabIndex={-1}>{t("module.lessons")}</h1>
      <p className="lesson-summary">{t("home.lessons.description")}</p>
      <div className="lesson-library-actions">
        <button className="lesson-button lesson-primary" disabled={loading} onClick={create}>{t("lessons.create")}</button>
        <label className="lesson-import">{t("lessons.import")}
          <input type="file" disabled={loading || importing} onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }} />
        </label>
      </div>
      {importing && <p role="status">{t("lessons.importing")}</p>}
      <label className="lesson-library-search">
        <span>{t("lessons.searchLessons")}</span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      {error && <p role="alert">{t(error === "load" ? "lessons.indexError" : error === "import" ? "lessons.importError" : "lessons.saveError")}</p>}
      {loading ? <p role="status">{t("lessons.loading")}</p>
        : !matching.length ? <p role="status">{t(lessons.length ? "lessons.noLessonMatches" : "lessons.empty")}</p>
          : <ul className="lesson-library">
            {matching.map(lesson => <li className="lesson-card" key={lesson.id}>
              {lesson.cover && <LessonCover lesson={lesson} />}
              <h2>{lessonText(lesson.title, language) || t("lessons.untitled")}</h2>
              {lessonPlainText(lesson.summary, language) && <p>{lessonPlainText(lesson.summary, language)}</p>}
              <div className="lesson-actions">
                <button className="lesson-button lesson-primary" onClick={() => {
                  setError(pending?.id === lesson.id ? "save" : undefined);
                  navigate(lessonEditPath(lesson.id));
                }}>{t("lessons.edit")}</button>
                <button className="lesson-button" onClick={() => remove(lesson)}>{t("lessons.remove")}</button>
              </div>
            </li>)}
          </ul>}
    </>}
  </main>;
}

function WithLessonCatalog({ children }: { children: (catalog: Catalog) => ReactNode }) {
  const { t } = useLanguage();
  const [catalog, setCatalog] = useState<Catalog>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let current: Catalog | undefined;
    getCatalog().then(value => {
      if (!active) { value.free(); return; }
      current = value;
      setCatalog(value);
    }, cause => {
      if (!active) return;
      console.error("Lesson catalog failed", cause);
      setFailed(true);
    });
    return () => { active = false; current?.free(); };
  }, [attempt]);

  if (catalog) return children(catalog);
  if (failed) return <>
    <p role="alert">{t("app.startup.error.title")}</p>
    <button className="lesson-button" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>{t("lessons.retry")}</button>
  </>;
  return <p role="status">{t("app.startup.loading")}</p>;
}
