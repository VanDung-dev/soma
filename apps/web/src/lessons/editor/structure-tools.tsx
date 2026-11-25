import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { Catalog } from "../../catalog/types";
import type { StudySession, StudyState } from "../../viewer/session";
import { useLanguage } from "../../i18n";

export function LessonStructureTools({ catalog, session, state, ids, detailsHost }: {
  catalog: Catalog;
  session: StudySession;
  state: Readonly<StudyState>;
  ids: string[];
  detailsHost?: HTMLElement | null;
}) {
  const { language, t } = useLanguage();
  const id = state.readingId;
  const detail = useMemo(() => ids.includes(id) ? catalog.detail(id) : undefined, [catalog, id, ids, state.structureIds]);
  const part = state.visibleIds.has(id) ? detail : undefined;
  const isolated = state.visibleIds.size === 1 && ids.length > 1;
  const otherLanguage = language === "vi" ? "en" : "vi";
  const title = part?.names[language];
  const otherName = part?.names[otherLanguage];
  const restoreRegion = () => {
    if (!session.showScene(ids)) return;
    if (part) session.browseStructure(part.source_id);
  };

  const card = part && <section className="lesson-part-card"
      aria-label={t("information.panel.label")} data-structure-id={part.source_id}>
      <div className="lesson-part-names">
        <h3>{title}</h3>
        {otherName && otherName !== title && <p className="international-name" lang={otherLanguage}>{otherName}</p>}
        {part.latin && part.latin !== title && part.latin !== otherName && <p className="latin-name" lang="la">{part.latin}</p>}
      </div>
      {ids.length > 1 && !isolated && <div className="lesson-part-actions">
        <button className="lesson-button" type="button"
          onClick={() => session.focus([part.source_id])}>{t("lessons.isolatePart")}</button>
      </div>}
      {isolated && <button className="lesson-button lesson-restore-region" type="button" onClick={restoreRegion}>{t("lessons.restoreRegion")}</button>}
    </section>;

  return <div className="lesson-structure-tools">
    <span className="sr-only" role="status">{title}</span>
    {card ? detailsHost ? createPortal(card, detailsHost) : card : null}
    {isolated && !part && <button className="lesson-button lesson-restore-region" type="button" onClick={restoreRegion}>{t("lessons.restoreRegion")}</button>}
  </div>;
}
