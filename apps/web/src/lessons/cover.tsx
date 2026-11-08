import { useEffect, useState } from "react";
import type { Lesson } from "./contract";
import { loadLessonImage } from "./images";

export function LessonCover({ lesson }: { lesson: Lesson }) {
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
  return url ? <img className="lesson-cover" src={url} alt="" loading="lazy" /> : null;
}
