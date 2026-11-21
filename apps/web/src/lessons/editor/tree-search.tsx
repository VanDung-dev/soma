import type { Catalog } from "../../anatomy/catalog/types";
import type { Language } from "../../i18n";

export function searchLessonTree(catalog: Catalog, query: string, language: Language) {
  const result = catalog.searchTree(query, language);
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
      return <>{label.slice(0, start)}<mark className="lesson-tree-match">{label.slice(start, end)}</mark>{label.slice(end)}</>;
    },
  };
}
