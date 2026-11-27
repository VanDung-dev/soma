import { memo, useMemo } from "react";
import type { Catalog } from "./types";
import { useLanguage } from "../i18n";
import "./structure.css";

export function useStructureSearch(catalog: Catalog, query: string, enabled: boolean) {
  const { language } = useLanguage();
  const term = query.trim();
  return useMemo(() => {
    if (!enabled || !term) return;
    const result = catalog.searchTree(term, language);
    if (!result) return;
    const highlights = new Map(Object.entries(result.highlights));
    return {
      bestId: result.bestId,
      folders: new Set(result.folders),
      structures: new Map(Object.entries(result.structures)),
      initialOpen: result.initialOpen,
      limits: result.limits,
      highlight(value: string) {
        const range = highlights.get(value);
        if (!range) return;
        const [start, end] = range;
        const label = value.normalize("NFC");
        return <>{label.slice(0, start)}<mark className="structure-tree-match">{label.slice(start, end)}</mark>{label.slice(end)}</>;
      },
    };
  }, [catalog, enabled, language, term]);
}

export const StructureSearch = memo(function StructureSearch({ query, onChange, disabled, empty }: {
  query: string; onChange: (query: string) => void; disabled: boolean; empty: boolean;
}) {
  const { t } = useLanguage();
  const label = t("search.label");
  return <div className="structure-search" role="search" aria-label={label}>
    <input type="search" aria-label={label} placeholder={label} autoComplete="off"
      disabled={disabled} value={query} onChange={event => onChange(event.target.value)} />
    {empty && <p aria-live="polite">{t("search.noResults")}</p>}
  </div>;
});
