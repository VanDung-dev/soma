import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Catalog } from "../catalog/types";
import { useCatalog } from "../catalog/use-catalog";
import { useLanguage } from "../i18n";
import type { Language } from "../i18n";
import { LessonEditor } from "./editor/editor";
import type { Lesson } from "./shared/contract";
import { LessonImageProvider } from "./shared/image-context";
import { LessonPlayer } from "./view/player";

export function LessonWorkspace({ lesson, authoring, studyVisible, onBack }: {
  lesson: Lesson;
  authoring?: {
    saved?: Lesson;
    saving: boolean;
    saveFailed: boolean;
    onSave: (lesson: Lesson) => Promise<boolean>;
    onDraftChange: (lesson: Lesson) => void;
  };
  studyVisible: boolean;
  onBack: (draft?: Lesson) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<Language>();
  const editing = !!authoring;
  const mode = editing ? (preview ? "preview" : "edit") : "view";

  useEffect(() => {
    if (editing) return;
    setSelected(undefined);
    setPreview(false);
    setPreviewLocale(undefined);
  }, [editing]);

  function render(catalog: Catalog) {
    if (authoring && !preview) {
      return <LessonEditor catalog={catalog} lesson={lesson} saved={authoring.saved ?? lesson} selected={selected}
        onSelect={setSelected} saving={authoring.saving} saveFailed={authoring.saveFailed} initialLocale={previewLocale}
        onChange={authoring.onSave} onDraftChange={authoring.onDraftChange} onBack={onBack} onPreview={(draft, language) => {
          authoring.onDraftChange({ ...draft, createdAt: authoring.saved?.createdAt, updatedAt: authoring.saved?.updatedAt });
          setPreviewLocale(language);
          setPreview(true);
        }} />;
    }
    return <LessonPlayer lesson={lesson} catalog={catalog} mode={authoring ? "preview" : "view"}
      previewLocale={authoring ? previewLocale : undefined} initialStepId={authoring ? selected : undefined}
      studyVisible={authoring ? undefined : studyVisible} onBack={onBack} onEdit={authoring ? () => setPreview(false) : undefined} />;
  }

  return <main className="lessons-screen" data-library={false} data-editor={mode === "edit"} data-player={mode !== "edit"}>
    <LessonImageProvider lesson={lesson}>
      <LessonWorkspaceCatalog key={mode}>{render}</LessonWorkspaceCatalog>
    </LessonImageProvider>
  </main>;
}

function LessonWorkspaceCatalog({ children }: { children: (catalog: Catalog) => ReactNode }) {
  const { t } = useLanguage();
  const { catalog, failed, retry } = useCatalog("Lesson catalog failed");

  if (catalog) return children(catalog);
  if (failed) return <>
    <p role="alert">{t("app.startup.error.title")}</p>
    <button className="lesson-button" onClick={retry}>{t("lessons.retry")}</button>
  </>;
  return <p role="status">{t("app.startup.loading")}</p>;
}
