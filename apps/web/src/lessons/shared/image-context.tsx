import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Lesson } from "./contract";
import { useLanguage } from "../../i18n";
import { checkImageCollection, loadLessonImages, readLessonImage, storeLessonImages } from "./images";
import { lessonImagePaths } from "./rich-text";
import { validate_lesson_resources } from "../../content/content.js";
import type { LessonImageStage } from "./archive";

type ImageContext = { urls: Map<string, string>; add: (blob: Blob, onProgress?: (stage: LessonImageStage) => void) => Promise<string> };
const context = createContext<ImageContext | null>(null);

export function useLessonImages() {
  const value = useContext(context);
  if (!value) throw new Error("Lesson image context is missing");
  return value;
}

export function LessonImageProvider({ lesson, children }: { lesson: Lesson; children: ReactNode }) {
  const { t } = useLanguage();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const urls = useRef(new Map<string, string>());
  const add = useRef<ImageContext["add"]>(async () => { throw new Error("Image storage is not ready"); });
  useEffect(() => {
    let active = true;
    const current = new Map<string, string>();
    urls.current = current;
    setReady(false); setFailed(false);
    void (async () => {
      const paths = lessonImagePaths(lesson);
      const images = paths.size ? await loadLessonImages(lesson.id) : new Map<string, Blob>();
      validate_lesson_resources(JSON.stringify(lesson), [...images.keys()]);
      if (!active) return;
      for (const [path, blob] of images) current.set(path, URL.createObjectURL(blob));
      add.current = async (blob, onProgress) => {
        onProgress?.("preparing");
        const image = await readLessonImage(blob, onProgress);
        if (!active) throw new Error("Lesson editor closed");
        onProgress?.("saving");
        const stored = await loadLessonImages(lesson.id);
        stored.set(image.path, image.blob);
        checkImageCollection(stored);
        await storeLessonImages(lesson.id, new Map([[image.path, image.blob]]));
        if (!active) throw new Error("Lesson editor closed");
        if (!current.has(image.path)) current.set(image.path, URL.createObjectURL(image.blob));
        return current.get(image.path)!;
      };
      setReady(true);
    })().catch(error => { if (active) { console.error("Lesson images failed", error); setFailed(true); } });
    return () => { active = false; current.forEach(url => URL.revokeObjectURL(url)); };
  }, [lesson.id, attempt]);
  if (failed) return <div role="alert"><p>{t("lessons.imageLoadError")}</p><button className="lesson-button" onClick={() => setAttempt(value => value + 1)}>{t("lessons.retry")}</button></div>;
  if (!ready) return <p role="status">{t("lessons.loading")}</p>;
  return <context.Provider value={{ urls: urls.current, add: (blob, onProgress) => add.current(blob, onProgress) }}>{children}</context.Provider>;
}
