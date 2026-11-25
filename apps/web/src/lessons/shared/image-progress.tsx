import { useLanguage } from "../../i18n";
import type { LessonImageStage } from "./archive";

export function LessonImageProgress({ stage }: { stage: LessonImageStage }) {
  const { t } = useLanguage();
  const label = t(`lessons.image.${stage}`);
  return <div className="lesson-image-progress" role="status"><progress aria-label={label} /><span>{label}</span></div>;
}
