import { useLanguage } from "../i18n";
import type { MessageKey } from "../i18n";
import type { StudyState } from "./study/session";
import type { ViewerHold, ViewerStatus } from "./viewer/contracts";

const statusMessages = {
  loading: "viewer.status.loading", preparing: "viewer.status.preparing", finishing: "viewer.status.finishing",
  loadError: "viewer.error.load", processError: "viewer.error.process", renderError: "viewer.error.render", contextLost: "viewer.error.contextLost",
} satisfies Record<ViewerStatus, MessageKey>;

export function ViewerStatusNotice({ state, totalSystems, className = "" }: {
  state: Readonly<StudyState>; totalSystems: number; className?: string;
}) {
  const { t } = useLanguage();
  const { building, error, status, loadedSystems, visibleIds, structureIds } = state;
  return <p className={`model-status${className ? ` ${className}` : ""}${error ? " model-error" : ""}`} role={error ? "alert" : "status"}>
    {!error && !building && structureIds.length ? t("viewer.status.visibleCount", { visible: visibleIds.size, total: structureIds.length })
      : t(statusMessages[status], { loaded: loadedSystems, total: totalSystems })}
  </p>;
}

export function ViewerLoadingProgress({ loadedSystems, totalSystems }: { loadedSystems: number; totalSystems: number }) {
  const { t } = useLanguage();
  return <progress className="model-progress" aria-label={t("viewer.loading.systems")} value={loadedSystems} max={totalSystems} />;
}

export function ViewerHoldProgress({ hold }: { hold: ViewerHold }) {
  return <svg className="model-hold-progress" data-action={hold.action} style={{ left: hold.x, top: hold.y }} viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="16" />
    <circle className="model-hold-fill" cx="20" cy="20" r="16" pathLength="100" />
  </svg>;
}
