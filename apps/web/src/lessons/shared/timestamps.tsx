import { useLanguage } from "../../i18n";
import type { Lesson } from "./contract";

const showTimestamps = import.meta.env.DEV && import.meta.env.VITE_DEBUG_LESSON_TIMESTAMPS === "1";

export function LessonTimestamps({ lesson }: { lesson: Pick<Lesson, "createdAt" | "updatedAt"> }) {
  const { language, t } = useLanguage();
  if (!showTimestamps) return null;

  const format = new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "medium" });

  function date(timestamp?: number) {
    if (timestamp === undefined) return t("lessons.dateUnknown");
    const value = new Date(timestamp);
    return <time dateTime={value.toISOString()}>{format.format(value)}</time>;
  }

  return <dl className="lesson-timestamps">
    <div><dt>{t("lessons.createdAt")}</dt><dd>{date(lesson.createdAt)}</dd></div>
    <div><dt>{t("lessons.updatedAt")}</dt><dd>{date(lesson.updatedAt)}</dd></div>
  </dl>;
}
