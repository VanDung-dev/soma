import { useEffect, useRef, useState } from "react";
import { getContent } from "../core";
import { useLanguage } from "../i18n";
import { emptyLessonText, LessonValidationError, lessonText, readLesson } from "./shared/contract";
import type { Lesson } from "./shared/contract";
import { LessonWorkspace } from "./workspace";
import { lessonEditPath, lessonViewPath } from "./routes";
import { exportLesson, importLesson, listLessons, newLessonId, nextLessonRevision, removeLesson, saveLesson } from "./shared/source";
import "./style.css";
import "./shared/rich-content.css";
import { loadLessonImages, prepareImportedLesson, retainLessonImages, storeLessonImages } from "./shared/images";
import { LessonImportIcon, LessonLibrary } from "./library/library";
import { LessonConfirmProvider, useLessonConfirm } from "./shared/confirm";

type LessonsPageProps = { editId?: string; viewId?: string; studyVisible: boolean; navigate: (path: string) => void };

export function LessonsPage(props: LessonsPageProps) {
  return <LessonConfirmProvider><LessonsPageContent {...props} /></LessonConfirmProvider>;
}

function LessonsPageContent({ editId, viewId, studyVisible, navigate }: LessonsPageProps) {
  const { language, t } = useLanguage();
  const confirm = useLessonConfirm();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [pending, setPending] = useState<Lesson>();
  const [error, setError] = useState<"load" | "save" | "import" | "export">();
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
  const editing = !!editId;
  const savedLesson = lessons.find(item => item.id === activeId);
  const draft = editing && pending?.id === activeId ? pending : savedLesson;
  useEffect(() => { title.current?.focus(); }, [editId, viewId]);

  async function update(next: Lesson) {
    if (saveBusy.current) return false;
    saveBusy.current = true;
    setSaving(true);
    const previous = lessons.find(lesson => lesson.id === next.id);
    let revised = next;
    try {
      const revision = nextLessonRevision(next.version, previous, Date.now());
      revised = previous ? { ...next, version: revision.version } : next;
      const saved = { ...revised, ...revision };
      await saveLesson(saved, previous);
      setLessons(current => previous ? current.map(lesson => lesson.id === saved.id ? saved : lesson) : [...current, saved]);
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
    await update({ id, version: 1, title: emptyLessonText, summary: emptyLessonText, modelId: "", steps: [] });
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
      const storedImages = await loadLessonImages(lesson.id);
      const previousPaths = new Set(storedImages.keys());
      const { importedLesson, additions } = await prepareImportedLesson(lesson, previous, storedImages, images);
      if (additions.size) await storeLessonImages(lesson.id, additions);
      try { await saveLesson(importedLesson, previous); }
      catch (error) {
        await retainLessonImages(lesson.id, previousPaths, previous).catch(cleanupError => console.error("Lesson import rollback failed", cleanupError));
        throw error;
      }
      setLessons(current => previous ? current.map(item => item.id === importedLesson.id ? importedLesson : item) : [...current, importedLesson]);
      setError(undefined);
      return importedLesson;
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
      if (!(cause instanceof LessonValidationError)) console.error("Lesson export failed", cause);
      setError("export");
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
    navigate("/lessons");
  }

  return <>
    {draft ? <LessonWorkspace key={draft.id} lesson={draft} studyVisible={studyVisible} onBack={leave}
      authoring={editing ? { saved: savedLesson, saving, saveFailed: error === "save", onSave: update, onDraftChange: setPending } : undefined} />
      : <main className="lessons-screen" data-library={!activeId} data-editor={editing} data-player={!!viewId && !editing}>
        {activeId ? <>
          <h1 ref={title} tabIndex={-1}>{t("module.lessons")}</h1>
          <p role={loading ? "status" : "alert"}>{t(loading ? "lessons.loading" : error === "load" ? "lessons.indexError" : "lessons.notFound")}</p>
          <button className="lesson-button" onClick={() => navigate("/lessons")}>{t("lessons.library")}</button>
        </> : <LessonLibrary lessons={lessons} loading={loading} importing={importing} exportingId={exportingId} titleRef={title} dragging={dragging} onDraggingChange={setDragging}
          error={error ? t(error === "load" ? "lessons.indexError" : error === "import" ? "lessons.importError"
            : error === "export" ? "lessons.exportError" : "lessons.saveError")
            : unreadableCount ? t("lessons.unreadableCount", { count: unreadableCount }) : undefined}
          saving={saving} onCreate={create} onImport={importFile} onStart={lesson => navigate(lessonViewPath(lesson.id))}
          onEdit={lesson => { setError(pending?.id === lesson.id ? "save" : undefined); navigate(lessonEditPath(lesson.id)); }}
          onExport={lesson => { void handleExport(lesson); }} onRemove={remove} />}
      </main>}
    {!activeId && dragging && <div className="lesson-library-drop-overlay" role="status">
      <span className="lesson-import-symbol" aria-hidden="true"><LessonImportIcon /></span><strong>{t(importing ? "lessons.importing" : loading ? "lessons.loading" : "lessons.dropToImport")}</strong><span>{t("lessons.importFileHint")}</span>
    </div>}
  </>;
}
