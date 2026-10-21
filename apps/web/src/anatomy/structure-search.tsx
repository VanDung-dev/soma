import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Structure } from "./catalog/types";
import { anatomyNames, structureName } from "./anatomy-names";
import { useLanguage } from "../i18n";

function Magnifier() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="10" cy="10" r="6" /><path d="m14.5 14.5 5 5" />
  </svg>;
}

const fold = (value: string) => value.toLocaleLowerCase("vi").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/g, "d");
const normalize = (value: string) => fold(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function createStructureSearch(structures: Structure[]) {
  const entries = structures.map(part => {
    const names = anatomyNames(part.source_name);
    const sides = part.laterality === "left" ? ["trai", "left"] : part.laterality === "right" ? ["phai", "right"] : [];
    const exact = [part.source_name, names.vi, names.en].flatMap(name => {
      const base = normalize(name);
      return [base, ...sides.map(side => base + " " + side)];
    });
    return { part, exact, text: normalize([structureName(part), structureName(part, "en"), part.source_name, part.latin, part.source_object].join(" ")) };
  });
  return (query: string) => {
    const text = normalize(query);
    if (!text) return [];
    const words = text.split(/\s+/);
    const exact: Structure[] = [], other: Structure[] = [];
    for (const entry of entries) {
      if (words.every(word => entry.text.includes(word))) (entry.exact.includes(text) ? exact : other).push(entry.part);
    }
    return exact.concat(other);
  };
}

export const StructureSearch = memo(function StructureSearch({ structures, disabled, onSelect, triggerId }: {
  structures: Structure[]; disabled: boolean; onSelect: (id: string) => void;
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
  const find = useMemo(() => createStructureSearch(structures), [structures]);
  const alphabetical = useMemo(() => {
    const collator = new Intl.Collator(language, { sensitivity: "base", numeric: true, ignorePunctuation: true });
    return structures.map(part => {
      const name = structureName(part, language);
      return { part, name, hasLetters: Number(/\p{L}/u.test(name)) };
    }).sort((a, b) => b.hasLetters - a.hasLetters || collator.compare(a.name, b.name)).map(entry => entry.part);
  }, [structures, language]);
  const results = useMemo(() => query.trim() ? find(query) : alphabetical, [find, query, alphabetical]);
  const shown = results.slice(0, limit);
  const otherLanguage = language === "vi" ? "en" : "vi";
  const activeId = shown[activeIndex] ? id + "-result-" + activeIndex : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, query]);
  const choose = (part: Structure) => {
    popover.current?.hidePopover();
    onSelect(part.source_id);
  };
  const close = () => {
    popover.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  };
  return <>
    <button ref={trigger} id={triggerId} className="structure-search-field" type="button" disabled={disabled} popoverTarget={id}
      aria-label={t("search.submit")} title={`${t("search.submit")} (F)`}><Magnifier /></button>
    <section ref={popover} id={id} className="structure-search-popover" popover="auto" role="dialog" aria-label={t("search.label")}
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
              const count = query.trim() ? shown.length : results.length;
              const next = Math.max(0, Math.min(count - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)));
              if (next >= shown.length) setLimit(next + 20);
              setActiveIndex(next);
            }} />
        </div>
        <p id={id + "-status"} className="search-status" role="status">{query.trim() ? results.length
          ? t("search.resultCount", { count: results.length }) + (results.length > shown.length ? " · " + t("search.refine") : "")
          : t("search.noResults") : "A–Z · " + t("search.resultCount", { count: results.length })}</p>
        <ul id={id + "-results"} className="structure-search-results" role="listbox" aria-label={t("search.label")}
          onScroll={event => {
            const list = event.currentTarget;
            if (!query.trim() && list.scrollHeight - list.scrollTop - list.clientHeight < 100) {
              setLimit(value => Math.min(value + 20, results.length));
            }
          }}>
          {shown.map((part, index) => {
            const title = structureName(part, language), otherName = structureName(part, otherLanguage);
            return <li key={part.source_id} role="presentation">
              <button id={id + "-result-" + index} type="button" role="option" tabIndex={-1} aria-selected={index === activeIndex}
                disabled={disabled} data-structure-id={part.source_id} onMouseDown={event => event.preventDefault()}
                onClick={() => choose(part)}>
                <span>{title}</span>
                {otherName !== title && <small lang={otherLanguage}>{otherName}</small>}
                {part.latin && <small lang="la">{part.latin}</small>}
              </button>
            </li>;
          })}
        </ul>
      </form>
    </section>
  </>;
});
