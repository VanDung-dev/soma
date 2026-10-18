import { useId, useMemo, useState } from "react";
import type { Structure } from "./catalog/types";
import { anatomyNames, structureName } from "./anatomy-names";

function Magnifier() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="10" cy="10" r="6" /><path d="m14.5 14.5 5 5" />
  </svg>;
}

const normalize = (value: string) => value.toLocaleLowerCase("vi").normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .replace(/đ/g, "d").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function searchStructures(structures: Structure[], query: string) {
  const text = normalize(query).trim();
  if (!text) return [];
  const words = text.split(/\s+/);
  return structures.filter(part => {
    const name = normalize(`${structureName(part)} ${structureName(part, "en")} ${part.source_name} ${part.latin} ${part.source_object}`);
    return words.every(word => name.includes(word));
  }).sort((a, b) => {
    const exact = (part: Structure) => {
      const names = anatomyNames(part.source_name);
      const sides = part.laterality === "left" ? ["trai", "left"] : part.laterality === "right" ? ["phai", "right"] : [];
      return [part.source_name, names.vi, names.en].some(name => {
        const base = normalize(name);
        return base === text || sides.some(side => `${base} ${side}` === text);
      });
    };
    return Number(exact(b)) - Number(exact(a));
  });
}

export function StructureSearch({ structures, disabled, onSelect }: {
  structures: Structure[]; disabled: boolean; onSelect: (id: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchStructures(structures, query), [structures, query]);
  const choose = (part: Structure) => { onSelect(part.source_id); setQuery(""); };
  return <form className="structure-search" role="search" aria-label="Tìm bộ phận" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setQuery("");
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); setQuery(""); }
  }} onSubmit={event => {
    event.preventDefault();
    if (!disabled && results[0]) choose(results[0]);
  }}>
    <div className="structure-search-field">
      <input id={id} type="search" placeholder="Tìm bộ phận" autoComplete="off" aria-label="Tìm bộ phận"
        value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} />
      <button type="submit" disabled={disabled || !results.length} aria-label="Tìm kiếm" title="Tìm kiếm"
        onMouseDown={event => event.preventDefault()}><Magnifier /></button>
    </div>
    {query.trim() && <div className="structure-search-popup">
      <p className="search-status" role="status">{results.length
        ? `${results.length} kết quả${results.length > 20 ? " · Nhập thêm để thu hẹp" : ""}`
        : "Không tìm thấy bộ phận phù hợp."}</p>
      {results.length > 0 && <ul className="structure-search-results" aria-label="Kết quả tìm bộ phận">
        {results.slice(0, 20).map(part => <li key={part.source_id}>
          <button type="button" disabled={disabled} data-structure-id={part.source_id}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(part)}>
            <span>{structureName(part)}</span>
            {structureName(part, "en") !== structureName(part) && <small lang="en">{structureName(part, "en")}</small>}
            {part.latin && <small lang="la">{part.latin}</small>}
          </button>
        </li>)}
      </ul>}
    </div>}
  </form>;
}
