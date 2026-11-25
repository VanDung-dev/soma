import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Lesson, LessonCoverCrop } from "../shared/contract";
import { loadLessonImage } from "../shared/images";

export function getCoverDimensions(aspect: number | undefined) {
  const containerAspect = 21 / 9;
  const currentAspect = aspect && !isNaN(aspect) && aspect > 0 ? aspect : containerAspect;
  if (currentAspect >= containerAspect) {
    return {
      widthPercent: (currentAspect / containerAspect) * 100,
      heightPercent: 100,
    };
  }
  return {
    widthPercent: 100,
    heightPercent: (containerAspect / currentAspect) * 100,
  };
}

export function calculateCoverClamps(aspect: number | undefined, zoom: number) {
  const dims = getCoverDimensions(aspect);
  const totalWidth = dims.widthPercent * zoom;
  const totalHeight = dims.heightPercent * zoom;
  return {
    clampX: Math.max(0, (totalWidth - 100) / 2),
    clampY: Math.max(0, (totalHeight - 100) / 2),
  };
}

export function useCoverAspect(src: string | undefined) {
  const [aspect, setAspect] = useState<number>();
  const updateAspect = useCallback((image: HTMLImageElement) => {
    if (image.naturalWidth && image.naturalHeight) setAspect(image.naturalWidth / image.naturalHeight);
  }, []);

  useEffect(() => {
    setAspect(undefined);
    if (!src) return;
    const image = new Image();
    image.onload = () => updateAspect(image);
    image.src = src;
  }, [src, updateAspect]);

  return { aspect, updateAspect };
}

export function LessonCoverImage({ src, alt, crop, aspect, decoding, onLoad }: {
  src: string;
  alt: string;
  crop?: LessonCoverCrop;
  aspect?: number;
  decoding?: HTMLImageElement["decoding"];
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
}) {
  const zoom = crop?.zoom ?? 1;
  const x = crop?.x ?? 0;
  const y = crop?.y ?? 0;
  const dims = getCoverDimensions(aspect);

  return <div className="lesson-cover-viewport" style={{ transform: `translate(${x}%, ${y}%) scale(${zoom})` }}>
    <img className="lesson-cover-img" src={src} alt={alt} decoding={decoding} onLoad={onLoad}
      style={{ width: `${dims.widthPercent}%`, height: `${dims.heightPercent}%` }} />
  </div>;
}

export function LessonCoverView({ src, alt = "", crop, className = "", onLoad, children }: {
  src: string;
  alt?: string;
  crop?: LessonCoverCrop;
  className?: string;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
  children?: ReactNode;
}) {
  const { aspect, updateAspect } = useCoverAspect(src);

  return <div className={`lesson-cover ${className}`.trim()}>
    <LessonCoverImage src={src} alt={alt} crop={crop} aspect={aspect} decoding="async" onLoad={event => {
      onLoad?.(event);
      updateAspect(event.currentTarget);
    }} />
    {children}
  </div>;
}

export function LessonCover({ lesson, className, children }: { lesson: Lesson; className?: string; children?: ReactNode }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    setUrl("");
    if (lesson.cover) void loadLessonImage(lesson.id, lesson.cover).then(blob => {
      if (active && blob) { url = URL.createObjectURL(blob); setUrl(url); }
    }, error => { console.error("Lesson card cover failed", error); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [lesson.id, lesson.cover]);
  return url ? <LessonCoverView src={url} crop={lesson.coverCrop} className={className}>{children}</LessonCoverView> : (
    <div className={`lesson-cover ${className ?? ""}`.trim()}>
      {children}
    </div>
  );
}
