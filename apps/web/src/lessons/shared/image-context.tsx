import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Lesson } from "./contract";
import { useLanguage } from "../../i18n";
import { checkImageCollection, loadLessonImages, readLessonImage, storeLessonImages } from "./images";
import { lessonImagePaths } from "./rich-text";
import type { LessonImageStage } from "./archive";

type ImageContext = { urls: Map<string, string>; paths: Map<string, string>; add: (blob: Blob, onProgress?: (stage: LessonImageStage) => void) => Promise<string> };
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
  const pathsByUrl = useRef(new Map<string, string>());
  const add = useRef<ImageContext["add"]>(async () => { throw new Error("Image storage is not ready"); });
  useEffect(() => {
    let active = true;
    const current = new Map<string, string>();
    const currentPaths = new Map<string, string>();
    urls.current = current;
    pathsByUrl.current = currentPaths;
    setReady(false); setFailed(false);
    void (async () => {
      const paths = lessonImagePaths(lesson);
      const images = paths.size ? await loadLessonImages(lesson.id, paths) : new Map<string, Blob>();
      if (!active) return;
      for (const [path, blob] of images) {
        const url = URL.createObjectURL(blob);
        current.set(path, url);
        currentPaths.set(url, path);
      }
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
        const existing = current.get(image.path);
        if (existing) return existing;
        const url = URL.createObjectURL(image.blob);
        current.set(image.path, url);
        currentPaths.set(url, image.path);
        return url;
      };
      setReady(true);
    })().catch(error => { if (active) { console.error("Lesson images failed", error); setFailed(true); } });
    return () => { active = false; currentPaths.forEach((_, url) => URL.revokeObjectURL(url)); };
  }, [lesson.id, attempt]);
  if (!ready && !failed) return <p role="status">{t("lessons.loading")}</p>;
  return <>
    {failed && <div role="alert"><p>{t("lessons.imageLoadError")}</p><button className="lesson-button" onClick={() => setAttempt(value => value + 1)}>{t("lessons.retry")}</button></div>}
    <context.Provider value={{ urls: urls.current, paths: pathsByUrl.current, add: (blob, onProgress) => add.current(blob, onProgress) }}>{children}</context.Provider>
  </>;
}
