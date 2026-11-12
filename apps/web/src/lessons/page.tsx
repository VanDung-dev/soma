import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getCatalog, getContent } from "../anatomy/core";
import type { Catalog } from "../anatomy/catalog/types";
import { useLanguage } from "../i18n";
import { LessonValidationError, lessonText, readLesson } from "./shared/contract";
import type { Lesson } from "./shared/contract";
import { emptyText, LessonEditor } from "./editor/editor";
import { LessonPlayer } from "./view/player";
import { lessonEditPath, lessonViewPath } from "./routes";
import { exportLesson, importLesson, listLessons, newLessonId, removeLesson, saveLesson } from "./shared/source";
import "./style.css";
import { LessonImageProvider } from "./shared/image-context";
import { storeLessonImages } from "./shared/images";
import { LessonLibrary } from "./library";
import { LessonConfirmProvider, useLessonConfirm } from "./shared/confirm";

export function LessonsPage({ editId, viewId, navigate }: { editId?: string; viewId?: string; navigate: (path: string) => void }) {
  return <LessonConfirmProvider><LessonsPageContent editId={editId} viewId={viewId} navigate={navigate} /></LessonConfirmProvider>;
}

function LessonsPageContent({ editId, viewId, navigate }: { editId?: string; viewId?: string; navigate: (path: string) => void }) {
  const { language, t } = useLanguage();
  const confirm = useLessonConfirm();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [pending, setPending] = useState<Lesson>();
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<"load" | "save" | "import">();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [exportingId, setExportingId] = useState<string>();
  const importBusy = useRef(false);
  const saveBusy = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    void getContent().then(async () => {
      if (!active) return;
      const result = await listLessons();
      if (!active) return;
      setLessons(result.lessons);
      setUnreadableCount(result.invalidKeys.length);
      for (const key of result.invalidKeys) console.error("Saved lesson could not be read", key);
    })
      .catch(cause => { if (active) { console.error("Lesson library failed", cause); setError("load"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const activeId = editId || viewId;
  const draft = pending?.id === activeId ? pending : lessons.find(item => item.id === activeId);
  const editing = !!editId;
  const viewing = !!viewId && !editing;
  useEffect(() => { setSelected(undefined); setPreview(false); }, [editId, viewId]);
  useEffect(() => { title.current?.focus(); }, [editing, viewing, preview]);

  async function update(next: Lesson) {
    if (saveBusy.current) return false;
    saveBusy.current = true;
    setSaving(true);
    const previous = lessons.find(lesson => lesson.id === next.id);
    const revised = previous ? { ...next, version: previous.version + 1 } : next;
    try {
      await saveLesson(revised, previous);
      setLessons(current => previous ? current.map(lesson => lesson.id === revised.id ? revised : lesson) : [...current, revised]);
      setPending(current => current === pending ? undefined : current);
      setError(undefined);
      return true;
    } catch (cause) {
      console.error("Lesson draft save failed", cause);
      setPending(current => current === pending ? revised : current);
      setError("save");
      return false;
    } finally {
      saveBusy.current = false;
      setSaving(false);
    }
  }

  async function create() {
    if (saveBusy.current || importBusy.current) return;
    const id = newLessonId();
    await update({ id, version: 1, title: emptyText, summary: emptyText, modelId: "", steps: [] });
    navigate(lessonEditPath(id));
  }

  async function importFile(file: File) {
    if (importBusy.current || saveBusy.current) return;
    importBusy.current = true;
    setImporting(true);
    setError(undefined);
    try {
      const { lesson, images } = await importLesson(file);
      const previous = lessons.find(item => item.id === lesson.id);
      if (previous && !await confirm(t("lessons.confirmReplace", { name: lessonText(previous.title, language) || t("lessons.untitled") }), t("lessons.replace"))) return;
      if (images.size) await storeLessonImages(lesson.id, images);
      await saveLesson(lesson, previous);
      setLessons(current => previous ? current.map(item => item.id === lesson.id ? lesson : item) : [...current, lesson]);
      setError(undefined);
      return lesson;
    } catch (cause) {
      console.error("Lesson import failed", cause);
      setError("import");
    } finally { importBusy.current = false; setImporting(false); }
  }

  async function handleExport(lesson: Lesson) {
    setExportingId(lesson.id);
    try {
      readLesson(lesson, true);
      setError(undefined);
      await exportLesson(lesson, language);
    } catch (cause) {
      if (cause instanceof LessonValidationError) {
        setError("save");
      } else {
        console.error("Lesson export failed", cause);
        setError("save");
      }
    } finally {
      setExportingId(undefined);
    }
  }

  async function remove(lesson: Lesson) {
    if (!await confirm(t("lessons.confirmRemove"), t("lessons.remove"))) return;
    try {
      await removeLesson(lesson);
      setLessons(current => current.filter(item => item.id !== lesson.id));
      setError(undefined);
    } catch (cause) {
      console.error("Lesson removal failed", cause);
      setError("save");
    }
  }

  async function leave(currentDraft?: Lesson) {
    if (saveBusy.current) return;
    const currentSaved = lessons.find(item => item.id === activeId);
    const unsavedDraft = currentDraft ?? pending;
    const hasUnsaved = unsavedDraft && (!currentSaved || JSON.stringify({ ...unsavedDraft, version: currentSaved.version }) !== JSON.stringify(currentSaved));
    if (error === "save" || hasUnsaved) {
      const choice = await confirm(t("lessons.confirmDiscard"), t("lessons.exitWithoutSaving"), t("lessons.saveAndExit"), t("lessons.continueEditing"));
      if (!choice) return;
      if (choice === "save" && (!unsavedDraft || !await update(unsavedDraft))) return;
    }
    setPending(undefined);
    setError(undefined);
    setPreview(false);
    navigate("/lessons");
  }

  const savedLesson = lessons.find(item => item.id === activeId);

  return <><main className="lessons-screen" data-library={!activeId} data-editor={editing && !preview} data-player={viewing || (editing && preview)}>
    {draft ? <>
      <LessonImageProvider key={draft.id} lesson={draft}>
      <WithLessonCatalog key={`${draft.id}/${viewing ? "view" : preview ? "preview" : "editor"}`}>{catalog => viewing
        ? <LessonPlayer lesson={draft} catalog={catalog} preview={false} onBack={leave} />
        : preview
          ? <LessonPlayer lesson={draft} catalog={catalog} preview onBack={leave} onEdit={() => setPreview(false)} />
          : <LessonEditor catalog={catalog} lesson={draft} saved={savedLesson ?? draft} selected={selected} onSelect={setSelected}
            saving={saving} saveFailed={error === "save"} onChange={update} onDraftChange={setPending} onPreview={current => { setPending(current); setPreview(true); }}
            onBack={leave} />}
      </WithLessonCatalog>
      </LessonImageProvider>
    </> : activeId ? <>
      <h1 ref={title} tabIndex={-1}>{t("module.lessons")}</h1>
      <p role={loading ? "status" : "alert"}>{t(loading ? "lessons.loading" : error === "load" ? "lessons.indexError" : "lessons.notFound")}</p>
      <button className="lesson-button" onClick={() => navigate("/lessons")}>{t("lessons.library")}</button>
    </> : <LessonLibrary lessons={lessons} loading={loading} importing={importing} exportingId={exportingId} titleRef={title} dragging={dragging} onDraggingChange={setDragging}
      error={error ? t(error === "load" ? "lessons.indexError" : error === "import" ? "lessons.importError" : "lessons.saveError")
        : unreadableCount ? t("lessons.unreadableCount", { count: unreadableCount }) : undefined}
      saving={saving} onCreate={create} onImport={importFile} onStart={lesson => navigate(lessonViewPath(lesson.id))}
      onEdit={lesson => { setError(pending?.id === lesson.id ? "save" : undefined); navigate(lessonEditPath(lesson.id)); }}
      onExport={lesson => { void handleExport(lesson); }} onRemove={remove} />}
  </main>
    {!activeId && dragging && <div className="lesson-library-drop-overlay" role="status">
      <span className="lesson-import-symbol" aria-hidden="true"><svg width="24" height="28" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H5a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z" /><path d="M14 2v7h7M12 13v8m-3-3 3 3 3-3" /></svg></span><strong>{t(importing ? "lessons.importing" : loading ? "lessons.loading" : "lessons.dropToImport")}</strong><span>{t("lessons.importFileHint")}</span>
    </div>}
  </>;
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
