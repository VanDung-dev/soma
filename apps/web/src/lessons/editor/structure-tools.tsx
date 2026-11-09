import { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { Catalog } from "../../anatomy/catalog/types";
import type { StudySession, StudyState } from "../../anatomy/study/session";
import { StructureSearch } from "../../anatomy/structure-search";
import { useLanguage } from "../../i18n";

export function LessonStructureTools({ catalog, session, state, ids, searchable = true, detailsHost }: {
  catalog: Catalog;
  session: StudySession;
  state: Readonly<StudyState>;
  ids: string[];
  searchable?: boolean;
  detailsHost?: HTMLElement | null;
}) {
  const { language, t } = useLanguage();
  const search = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const id = state.readingId;
  const detail = useMemo(() => ids.includes(id) ? catalog.detail(id) : undefined, [catalog, id, ids, state.structureIds]);
  const part = state.visibleIds.has(id) ? detail : undefined;
  const isolated = state.visibleIds.size === 1 && ids.length > 1;
  const otherLanguage = language === "vi" ? "en" : "vi";
  const title = part?.names[language];
  const otherName = part?.names[otherLanguage];
  const focusSearch = () => (search.current?.querySelector<HTMLButtonElement>("button")
    ?? tools.current?.closest(".lesson-model")?.querySelector<HTMLButtonElement>(".structure-search-field"))?.focus({ preventScroll: true });

  const card = part && <section className="lesson-part-card"
      aria-label={t("information.panel.label")} data-structure-id={part.source_id}>
      <div className="information-heading">
        <div className="lesson-part-names">
          <h3>{title}</h3>
          {otherName && otherName !== title && <p className="international-name" lang={otherLanguage}>{otherName}</p>}
          {part.latin && part.latin !== title && part.latin !== otherName && <p className="latin-name" lang="la">{part.latin}</p>}
        </div>
        <div className="lesson-part-actions">
        {ids.length > 1 && !isolated && <button className="lesson-button" type="button"
          onClick={() => {
            if (session.focus([part.source_id])) focusSearch();
          }}>{t("lessons.isolatePart")}</button>}
        <button className="controls-info lesson-part-close" type="button" onClick={() => {
          session.browseStructure("");
          focusSearch();
        }} aria-label={t("lessons.closePart")} title={t("lessons.closePart")}><span aria-hidden="true">×</span></button>
        </div>
      </div>
    </section>;

  return <div className="lesson-structure-tools" ref={tools}>
    {searchable && <div ref={search}>
      <StructureSearch catalog={catalog} structureIds={ids} disabled={!ids.length} compact
        label={t("lessons.findPart")} onSelect={partId => {
          if (!state.visibleIds.has(partId) && !session.showScene(ids)) return;
          session.browseStructure(partId);
        }} />
    </div>}
    <span className="sr-only" role="status">{title}</span>
    {card ? detailsHost ? createPortal(card, detailsHost) : card
      : !isolated && <p className="model-status lesson-pick-hint">{t("lessons.pickPartHint")}</p>}
    {isolated && <button className="lesson-button lesson-restore-region" type="button" onClick={() => {
      if (session.showScene(ids)) focusSearch();
    }}>{t("lessons.restoreRegion")}</button>}
  </div>;
}
