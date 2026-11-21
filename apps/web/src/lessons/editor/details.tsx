import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Language } from "../../i18n";
import { translateMessage, useLanguage } from "../../i18n";
import { LineIcon } from "../../icons";
import type { Lesson, LessonCoverCrop } from "../shared/contract";
import { useLessonImages } from "../shared/image-context";
import { lessonPlainText } from "../shared/rich-text";
import type { LessonImageStage } from "../shared/archive";
import { LessonCoverView, calculateCoverClamps, getCoverDimensions } from "./cover";

export function LessonCoverEditor({ lesson, onChange }: {
  lesson: Lesson;
  onChange: (patch: Partial<Lesson>) => void;
}) {
  const { t } = useLanguage();
  const images = useLessonImages();
  const [uploading, setUploading] = useState(false);
  const [stage, setStage] = useState<LessonImageStage>("preparing");
  const [failed, setFailed] = useState<string>();
  const [aspect, setAspect] = useState<number>();
  const [dragging, setDragging] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const active = useRef(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number; rect: DOMRect } | null>(null);

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const saveCover = useEffectEvent((cover: string) => onChange({ cover, coverCrop: { zoom: 1, x: 0, y: 0 } }));

  const coverUrl = lesson.cover ? images.urls.get(lesson.cover) : undefined;
  const [tempCrop, setTempCrop] = useState<LessonCoverCrop>(lesson.coverCrop ?? { zoom: 1, x: 0, y: 0 });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (modalOpen) {
      setTempCrop(lesson.coverCrop ?? { zoom: 1, x: 0, y: 0 });
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [modalOpen, lesson.coverCrop]);

  useEffect(() => {
    setAspect(undefined);
    if (!coverUrl) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setAspect(img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = coverUrl;
  }, [coverUrl]);

  const { clampX, clampY } = calculateCoverClamps(aspect, tempCrop.zoom);
  const dims = getCoverDimensions(aspect);

  function updateZoom(targetZoom: number) {
    const nextZoom = Math.min(3, Math.max(1, Math.round(targetZoom * 100) / 100));
    const { clampX: newClampX, clampY: newClampY } = calculateCoverClamps(aspect, nextZoom);
    const nextX = Math.min(newClampX, Math.max(-newClampX, tempCrop.x));
    const nextY = Math.min(newClampY, Math.max(-newClampY, tempCrop.y));
    setTempCrop({ zoom: nextZoom, x: nextX, y: nextY });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: tempCrop.x,
      initY: tempCrop.y,
      rect,
    };
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const { startX, startY, initX, initY, rect } = dragRef.current;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const percentX = (deltaX / rect.width) * 100;
    const percentY = (deltaY / rect.height) * 100;
    const nextX = Math.min(clampX, Math.max(-clampX, Math.round((initX + percentX) * 10) / 10));
    const nextY = Math.min(clampY, Math.max(-clampY, Math.round((initY + percentY) * 10) / 10));
    setTempCrop({ zoom: tempCrop.zoom, x: nextX, y: nextY });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      dragRef.current = null;
      setDragging(false);
    }
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    updateZoom(tempCrop.zoom + delta);
  }

  function handleApply() {
    onChange({ coverCrop: tempCrop });
    setModalOpen(false);
  }

  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file?: File | null) {
    if (!file) return;
    setUploading(true);
    setFailed(undefined);
    setStage("preparing");
    void images.add(file, value => {
      if (active.current) setStage(value);
    }).then(url => {
      if (!active.current) return;
      const path = [...images.urls].find(([, value]) => value === url)?.[0];
      if (!path) throw new Error("Lesson cover was not stored");
      saveCover(path);
    }).catch(error => {
      if (active.current) {
        console.error("Lesson cover failed", error);
        setFailed(String(error));
      }
    }).finally(() => {
      if (active.current) setUploading(false);
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
      if (!dragOver) setDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  return <div className="lesson-cover-editor">
    {lesson.cover && coverUrl ? (
      <div
        className="lesson-cover-preview-card"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-dragging={dragOver}
      >
        <LessonCoverView src={coverUrl} crop={lesson.coverCrop} alt={t("lessons.cover")}>
          <span className="lesson-cover-badge" aria-label={t("lessons.coverRatio")}>21:9</span>
          {dragOver && (
            <div className="lesson-cover-drop-replace" aria-hidden="true">
              <span>{t("lessons.coverDropActive")}</span>
            </div>
          )}
        </LessonCoverView>

        <div className="lesson-cover-actions">
          <button type="button" className="lesson-button lesson-primary" onClick={() => setModalOpen(true)}>
            {t("lessons.editCover")}
          </button>
          <label className="lesson-button lesson-cover-upload">
            {t("lessons.changeCover")}
            <input
              type="file"
              ref={fileInputRef}
              aria-label={t("lessons.changeCover")}
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                handleFile(file);
              }}
            />
          </label>
          <button
            type="button"
            className="lesson-button"
            disabled={uploading}
            onClick={() => onChange({ cover: undefined, coverCrop: undefined })}
          >
            {t("lessons.removeCover")}
          </button>
        </div>
      </div>
    ) : (
      <div
        className="lesson-cover-dropzone"
        data-dragging={dragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label={t("lessons.coverDropOrBrowse")}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <div className="lesson-cover-dropzone-inner">
          <div className="lesson-cover-dropzone-icon" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>

          <div className="lesson-cover-dropzone-content">
            <h3 className="lesson-cover-dropzone-title">{t("lessons.coverUploadPrompt")}</h3>
            <p className="lesson-cover-dropzone-prompt">
              {dragOver ? t("lessons.coverDropActive") : t("lessons.coverDropOrBrowse")}
            </p>
          </div>

          <label
            className="lesson-button lesson-primary lesson-cover-upload"
            onClick={e => e.stopPropagation()}
          >
            <span aria-hidden="true">+</span> {t("lessons.coverSelectButton")}
            <input
              type="file"
              ref={fileInputRef}
              aria-label={t("lessons.cover")}
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                handleFile(file);
              }}
            />
          </label>

          <div className="lesson-cover-specs">
            <span className="lesson-cover-spec-badge">{t("lessons.coverRatio")}</span>
            <span className="lesson-cover-spec-badge">{t("lessons.coverFormats")}</span>
            <span className="lesson-cover-spec-badge">{t("lessons.coverSizeLimit")}</span>
          </div>

          <p className="lesson-cover-spec-hint">
            {t("lessons.coverResolutionHint")}
          </p>
        </div>
      </div>
    )}
    {uploading && <div className="lesson-image-progress" role="status"><progress aria-label={t(`lessons.image.${stage}`)} /><span>{t(`lessons.image.${stage}`)}</span></div>}
    {failed && <p role="alert">{t("lessons.imageAddError")} {failed}</p>}

    {lesson.cover && coverUrl && <dialog
      ref={dialogRef}
      className="lesson-cover-modal"
      onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}
      onCancel={() => setModalOpen(false)}
    >
      <header className="lesson-cover-modal-header">
        <h2>{t("lessons.editCoverTitle")}</h2>
        <button
          type="button"
          className="controls-info"
          aria-label={t("lessons.closeEditCover")}
          onClick={() => setModalOpen(false)}
        >
          <LineIcon name="close-small" size={14} />
        </button>
      </header>

      <div className="lesson-cover-modal-body">
        <div
          className="lesson-cover-modal-frame"
          data-dragging={dragging}
          tabIndex={0}
          role="region"
          aria-label={t("lessons.cropHelp")}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        >
          <div
            className="lesson-cover-viewport"
            style={{
              transform: `translate(${tempCrop.x}%, ${tempCrop.y}%) scale(${tempCrop.zoom})`,
            }}
          >
            <img
              className="lesson-cover-img"
              src={coverUrl}
              alt={t("lessons.cover")}
              style={{
                width: `${dims.widthPercent}%`,
                height: `${dims.heightPercent}%`,
              }}
            />
          </div>
          <div className="lesson-cover-grid" aria-hidden="true" />
          <span className="lesson-cover-hint" aria-hidden="true">
            <span className="lesson-cover-hint-icon">✥</span>
            {t("lessons.cropHelp")}
          </span>
        </div>

        <div className="lesson-cover-modal-zoom">
          <button
            type="button"
            className="lesson-button lesson-cover-tool"
            disabled={tempCrop.zoom <= 1}
            aria-label={t("lessons.zoomOut")}
            title={t("lessons.zoomOut")}
            onClick={() => updateZoom(tempCrop.zoom - 0.1)}
          >–</button>
          <input
            type="range"
            min="1"
            max="3"
            step="0.02"
            value={tempCrop.zoom}
            aria-label={t("lessons.zoomCover")}
            onChange={e => updateZoom(Number(e.target.value))}
          />
          <button
            type="button"
            className="lesson-button lesson-cover-tool"
            disabled={tempCrop.zoom >= 3}
            aria-label={t("lessons.zoomIn")}
            title={t("lessons.zoomIn")}
            onClick={() => updateZoom(tempCrop.zoom + 0.1)}
          >+</button>
          <span className="lesson-cover-zoom-val">{Math.round(tempCrop.zoom * 100)}%</span>
        </div>
      </div>

      <footer className="lesson-cover-modal-footer">
        <button
          type="button"
          className="lesson-button"
          disabled={tempCrop.zoom === 1 && tempCrop.x === 0 && tempCrop.y === 0}
          onClick={() => setTempCrop({ zoom: 1, x: 0, y: 0 })}
        >{t("lessons.resetCoverFraming")}</button>
        <div className="lesson-cover-modal-actions">
          <button
            type="button"
            className="lesson-button"
            onClick={() => setModalOpen(false)}
          >{t("lessons.cancel")}</button>
          <button
            type="button"
            className="lesson-button lesson-primary"
            onClick={handleApply}
          >{t("lessons.apply")}</button>
        </div>
      </footer>
    </dialog>}
  </div>;
}

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
