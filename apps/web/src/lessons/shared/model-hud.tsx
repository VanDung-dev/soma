import type { ReactNode } from "react";
import type { StudyState } from "../../anatomy/study/session";
import { ViewerLoadingProgress, ViewerStatusNotice } from "../../anatomy/viewer-status";
import { useLanguage } from "../../i18n";

export function LessonModelHud({
  className, state, totalSystems = 0, status, beforeStatus, afterStatus, actions, showProgress = true, showCredit = true,
}: {
  className: string;
  state?: Readonly<StudyState>;
  totalSystems?: number;
  status?: ReactNode;
  beforeStatus?: ReactNode;
  afterStatus?: ReactNode;
  actions?: ReactNode;
  showProgress?: boolean;
  showCredit?: boolean;
}) {
  const { t } = useLanguage();
  return <>
    <div className={`model-hud lesson-model-hud ${className}`}>
      {beforeStatus}
      {status ?? (state && <ViewerStatusNotice state={state} totalSystems={totalSystems} />)}
      {showProgress && state?.building && !state.error && <ViewerLoadingProgress loadedSystems={state.loadedSystems} totalSystems={totalSystems} />}
      {afterStatus}
      {actions && <div className="lesson-model-tools">{actions}</div>}
    </div>
    {showCredit && <a className="lesson-model-credit" href="/models/z-anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer"
      aria-label={t("credit.link")}>Z-Anatomy</a>}
  </>;
}
