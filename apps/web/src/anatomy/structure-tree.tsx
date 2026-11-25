import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Catalog, FolderView } from "../catalog/types";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";

interface TreeSearch {
  bestId?: string;
  folders: ReadonlySet<string>;
  structures: ReadonlyMap<string, string>;
  initialOpen: string[];
  limits: Record<string, number>;
  highlight: (label: string) => ReactNode | undefined;
}

interface TreeProps {
  catalog: Catalog;
  rootId?: string;
  rootIds?: readonly string[];
  visibleIds: ReadonlySet<string>;
  selected: string;
  targetId?: string;
  reveal?: { id: string };
  search?: TreeSearch;
  disabled: boolean;
  onVisibility: (ids: string[], shown: boolean, targetId?: string) => void;
  onSelect: (id: string) => void;
  onTarget: (id: string) => void;
  onFocus: (ids: string[], targetId?: string) => void;
}

function VisibilityCheckbox({ count, total, label, disabled, onChange }: {
  count: number; total: number; label: string; disabled: boolean; onChange: (shown: boolean) => void;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLInputElement>(null);
  const mixed = count > 0 && count < total;
  const checked = total > 0 && count === total;
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <label className="visibility-checkbox">
    <input ref={ref} type="checkbox" aria-label={t("tree.showStructure", { name: label })} checked={checked}
      disabled={disabled || !total} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onChange={event => onChange(event.target.checked)} />
    <span className="visibility-checkbox-icon" aria-hidden="true"><LineIcon name={checked ? "square-to-confirm-square-twotone-transition" : "confirm-square-twotone-to-square-transition"} size={24} /></span>
  </label>;
}

export const StructureTree = memo(function StructureTree(props: TreeProps) {
  const { t } = useLanguage();
  const { search, reveal } = props;
  const path = useMemo(() => {
    if (!reveal) return [];
    const entries = props.catalog.reveal(reveal.id);
    return entries[0]?.[0] === reveal.id ? entries.slice(1) : entries;
  }, [props.catalog, reveal]);
  const [open, setOpen] = useState<string[]>(() => path.map(([id]) => id));
  const [limits, setLimits] = useState<Record<string, number>>(() => Object.fromEntries(path));
  const [searchExpansion, setSearchExpansion] = useState<{ search: TreeSearch; open: string[] }>();
  useEffect(() => {
    if (!reveal) return;
    setOpen(path.map(([id]) => id));
    setLimits(Object.fromEntries(path));
  }, [path, reveal]);
  const displayedOpen = searchExpansion && searchExpansion.search === search ? searchExpansion.open : search?.initialOpen ?? open;
  const displayedLimits = search?.limits ?? limits;
  const rows = useMemo(() => props.catalog.tree(displayedOpen, displayedLimits, [...props.visibleIds]),
    [props.catalog, displayedOpen, displayedLimits, props.visibleIds]);
  const grow = useCallback((id: string, limit: number) => setLimits(current => current[id] === limit ? current : { ...current, [id]: limit }), []);
  const toggle = (folder: FolderView) => {
    const descendants = (node: FolderView): string[] => [node.target.id, ...node.children.flatMap(descendants)];
    const closing = new Set(descendants(folder));
    const opened = displayedOpen.includes(folder.target.id);
    if (search) {
      setSearchExpansion({ search, open: opened ? displayedOpen.filter(id => !closing.has(id)) : [...displayedOpen, folder.target.id] });
      return;
    }
    const pathIndex = path.findIndex(([id]) => id === folder.target.id);
    const descendantsToReveal = pathIndex < 0 ? [] : path.slice(0, pathIndex);
    setOpen(current => opened ? current.filter(id => !closing.has(id)) : [...new Set([...current, folder.target.id, ...descendantsToReveal.map(([id]) => id)])]);
    setLimits(current => {
      const next = { ...current };
      for (const id of closing) delete next[id];
      if (!opened) for (const [id, limit] of descendantsToReveal) next[id] = limit;
      next[folder.target.id] = 40;
      return next;
    });
  };
  const revealRow = useCallback((element: HTMLLIElement | null) => {
    if (element && window.matchMedia("(min-width: 901px)").matches) element.scrollIntoView({ block: "nearest" });
  }, [search?.bestId, reveal]);
  const revealId = search ? search.bestId : reveal?.id;
  const revealTarget = search ? search.structures.get(search.bestId ?? "") : path[0]?.[0];
  const roots = rows.filter(folder => {
    const id = folder.target.id;
    return (!search || search.folders.has(id)) && (props.rootIds ? props.rootIds.includes(id) : !props.rootId || id === props.rootId);
  });
  return <nav aria-label={t("tree.navigation.label")}><ul className="structure-tree">
    {roots.map(folder => <Folder key={folder.target.id} folder={folder} props={props} open={displayedOpen} grow={grow} toggle={toggle}
      revealRow={revealRow} revealId={revealId} revealTarget={revealTarget} />)}
  </ul></nav>;
});

function Folder({ folder, props, open, grow, toggle, revealRow, revealId, revealTarget }: {
  folder: FolderView; props: TreeProps; open: string[]; grow: (id: string, limit: number) => void;
  toggle: (folder: FolderView) => void; revealRow: (element: HTMLLIElement | null) => void;
  revealId?: string;
  revealTarget?: string;
}) {
  const { language, t } = useLanguage();
  const { target } = folder;
  const { search } = props;
  const opened = open.includes(target.id);
  const searching = !!search;
  const more = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (searching || !folder.more || !more.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) grow(target.id, Math.min(folder.limit + 40, folder.total));
    }, { root: more.current.closest(".catalog-tree"), rootMargin: "200px" });
    observer.observe(more.current);
    return () => observer.disconnect();
  }, [folder.more, folder.limit, folder.total, target.id, grow, searching]);
  const otherLanguage = language === "vi" ? "en" : "vi";
  const title = target.names[language], otherName = target.names[otherLanguage];
  const highlight = search?.highlight;
  const current = props.targetId === target.id;
  const children = search ? folder.children.filter(child => search.folders.has(child.target.id)) : folder.children;
  const structures = search ? folder.structures.filter(part => search.structures.get(part.source_id) === target.id) : folder.structures;
  const focusFolder = () => { if (!props.disabled && target.count) props.onFocus([], target.id); };
  return <li data-target-id={target.id} ref={revealId === target.id ? revealRow : undefined}>
    <div className={`tree-row folder-row${current ? " is-selected" : ""}`} onDoubleClick={focusFolder}>
      <button className="folder-toggle" aria-label={t(opened ? "tree.close" : "tree.open", { name: title })} aria-expanded={opened}
        disabled={search && !Object.hasOwn(search.limits, target.id)}
        onClick={() => toggle(folder)} onDoubleClick={event => event.stopPropagation()}>
        <LineIcon name={opened ? "chevron-small-down" : "chevron-small-right"} size={24} />
      </button>
      {target.count > 0 ? <VisibilityCheckbox count={folder.visible} total={target.count} label={title} disabled={props.disabled}
        onChange={shown => props.onVisibility(props.catalog.members(target.id), shown, target.id)} /> : <span className="tree-no-model" aria-hidden="true">—</span>}
      <button className="tree-name" onClick={() => props.onTarget(target.id)} aria-current={current ? "true" : undefined}
        data-search-best={search?.bestId === target.id || undefined}
        aria-keyshortcuts={target.count ? "Shift+Enter" : undefined} title={target.count ? t("tree.focusHint", { name: title }) : undefined}
        onKeyDown={event => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); focusFolder(); } }}>
        {highlight?.(title) ?? title}{otherName !== title && <small lang={otherLanguage}>{highlight?.(otherName) ?? otherName}</small>}
      </button>
      <small className="tree-count">{target.count ? <><span>{target.count}</span>{" "}<span>{t(language === "en" && target.count === 1 ? "tree.structureCount.one" : "tree.structureCount.other")}</span></> : t("tree.noModel")}</small>
    </div>
    {opened && <ul>
      {children.map(child => <Folder key={child.target.id} folder={child} props={props} open={open} grow={grow} toggle={toggle} revealRow={revealRow} revealId={revealId} revealTarget={revealTarget} />)}
      {structures.map((part, index) => {
        const id = part.source_id, title = part.names[language], otherName = part.names[otherLanguage];
        const current = props.selected === id;
        const latin = part.latin !== title && part.latin !== otherName ? highlight?.(part.latin) : undefined;
        return <li key={id} ref={revealId === id && target.id === revealTarget ? revealRow : undefined}
          className={`tree-row part-row${current ? " is-selected" : ""}`} data-structure-id={id}
          onDoubleClick={() => { if (!props.disabled) props.onFocus([id]); }}>
          <VisibilityCheckbox count={Number(props.visibleIds.has(id))} total={1} label={title} disabled={props.disabled}
            onChange={shown => props.onVisibility([id], shown)} />
          <button className="tree-name" disabled={props.disabled} aria-current={current ? "true" : undefined}
            data-search-best={search?.bestId === id || undefined}
            aria-keyshortcuts="Shift+Enter" title={t("tree.focusHint", { name: title })}
            onKeyDown={event => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); props.onFocus([id]); } }}
            onClick={() => props.onSelect(id)} onFocus={event => {
              if (searching) return;
              if (index >= folder.limit - 10 && folder.more) grow(target.id, Math.min(folder.limit + 40, folder.total));
              if (event.currentTarget.closest<HTMLElement>(".module-page")?.dataset.focusSource === "keyboard") props.onSelect(id);
            }}>{highlight?.(title) ?? title}{otherName !== title && <small lang={otherLanguage}>{highlight?.(otherName) ?? otherName}</small>}
            {latin && <small lang="la">{latin}</small>}</button>
        </li>;
      })}
      {!searching && folder.more && <li ref={more} className="tree-load-more" aria-hidden="true" />}
    </ul>}
  </li>;
}
