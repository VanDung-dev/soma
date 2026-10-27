import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Catalog, SearchRow } from "./catalog/types";
import { useLanguage } from "../i18n";

function Magnifier() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="10" cy="10" r="6" /><path d="m14.5 14.5 5 5" />
  </svg>;
}

export const StructureSearch = memo(function StructureSearch({ catalog, disabled, onSelect, triggerId }: {
  catalog: Catalog; disabled: boolean; onSelect: (id: string) => void;
  triggerId?: string;
}) {
  const id = useId();
  const { language, t } = useLanguage();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [limit, setLimit] = useState(20);
  const results = useMemo(() => catalog.search(query, language, limit), [catalog, query, language, limit, disabled]);
  const shown = results.items;
  const otherLanguage = language === "vi" ? "en" : "vi";
  const activeId = shown[activeIndex] ? id + "-result-" + activeIndex : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, query]);
  const choose = (part: SearchRow) => {
    popover.current?.hidePopover();
    onSelect("source_id" in part ? part.source_id : part.id);
  };
  const close = () => {
    popover.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  };
  const dialog = <section ref={popover} id={id} className="structure-search-popover" popover="auto" role="dialog" aria-label={t("search.label")}
      onToggle={event => {
        if (event.currentTarget.matches(":popover-open")) {
          input.current?.focus({ preventScroll: true });
          event.currentTarget.querySelector(".structure-search-results")?.scrollTo({ top: 0 });
        }
        else { setQuery(""); setActiveIndex(0); setLimit(20); }
      }}>
      <form className="structure-search" role="search" aria-label={t("search.label")} onKeyDown={event => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          close();
        }
      }} onSubmit={event => {
        event.preventDefault();
        if (!disabled && shown[activeIndex]) choose(shown[activeIndex]);
      }}>
        <div className="structure-search-input">
          <Magnifier />
          <input ref={input} type="search" role="combobox" placeholder={t("search.label")} autoComplete="off"
            aria-label={t("search.label")} aria-expanded={!!shown.length} aria-autocomplete="list"
            aria-controls={id + "-results"} aria-describedby={id + "-status"} aria-activedescendant={activeId}
            value={query} disabled={disabled} onChange={event => { setQuery(event.target.value); setActiveIndex(0); setLimit(20); }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing || !shown.length || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
              event.preventDefault();
              const count = query.trim() ? shown.length : results.total;
              const next = Math.max(0, Math.min(count - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)));
              if (next >= shown.length) setLimit(next + 20);
              setActiveIndex(next);
            }} />
        </div>
        <p id={id + "-status"} className="search-status" role="status">{query.trim() ? results.total
          ? t("search.resultCount", { count: results.total }) + (results.total > shown.length ? " · " + t("search.refine") : "")
          : t("search.noResults") : "A–Z · " + t("search.resultCount", { count: results.total })}</p>
        <ul id={id + "-results"} className="structure-search-results" role="listbox" aria-label={t("search.label")}
          onScroll={event => {
            const list = event.currentTarget;
            if (!query.trim() && list.scrollHeight - list.scrollTop - list.clientHeight < 100) {
              setLimit(value => Math.min(value + 20, results.total));
            }
          }}>
          {shown.map((part, index) => {
            const title = part.names[language], otherName = part.names[otherLanguage];
            const structure = "source_id" in part;
            return <li key={structure ? part.source_id : part.id} role="presentation">
              <button id={id + "-result-" + index} type="button" role="option" tabIndex={-1} aria-selected={index === activeIndex}
                disabled={disabled} data-structure-id={structure ? part.source_id : undefined} data-target-id={structure ? undefined : part.id} onMouseDown={event => event.preventDefault()}
                onClick={() => choose(part)}>
                <span>{title}</span>
                {otherName !== title && <small lang={otherLanguage}>{otherName}</small>}
                {structure ? part.latin && <small lang="la">{part.latin}</small>
                  : <small>{part.count} {t(language === "en" && part.count === 1 ? "tree.structureCount.one" : "tree.structureCount.other")}</small>}
              </button>
            </li>;
          })}
        </ul>
      </form>
    </section>;
  return <>
    <button ref={trigger} id={triggerId} className="structure-search-field" type="button" disabled={disabled} popoverTarget={id}
      aria-label={t("search.submit")} title={`${t("search.submit")} (F)`}><Magnifier /></button>
    {typeof document === "undefined" ? dialog : createPortal(dialog, document.body)}
  </>;
});
