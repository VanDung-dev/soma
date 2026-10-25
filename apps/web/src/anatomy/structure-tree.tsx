import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, StudyTarget, Structure } from "./catalog/types";
import { indexCatalog, structureIds } from "./catalog";
import { structureName, targetName } from "./anatomy-names";
import { useLanguage } from "../i18n";
import { LineIcon } from "../icons";

const systemOrder = [
  "group:skeletal-system", "group:muscular-insertions", "group:joints",
  "group:lymphoid-organs", "group:cardiovascular-system", "group:nervous-system",
  "group:visceral-systems", "group:muscular-system", "group:body-regions",
];

interface TreeProps {
  catalog: Catalog;
  structures: Structure[];
  visibleIds: ReadonlySet<string>;
  selected: string;
  targetId?: string;
  reveal?: { id: string };
  disabled: boolean;
  onVisibility: (ids: string[], shown: boolean) => void;
  onSelect: (id: string) => void;
  onTarget: (id: string) => void;
  onFocus: (ids: string[], targetId?: string) => void;
}

function VisibilityCheckbox({ ids, visibleIds, label, disabled, onVisibility }: Pick<TreeProps, "visibleIds" | "disabled" | "onVisibility"> & { ids: string[]; label: string }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLInputElement>(null);
  let count = 0;
  for (const id of ids) if (visibleIds.has(id)) count++;
  const mixed = count > 0 && count < ids.length;
  const checked = ids.length > 0 && count === ids.length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <label className="visibility-checkbox">
    <input ref={ref} type="checkbox" aria-label={t("tree.showStructure", { name: label })} checked={checked}
      disabled={disabled || !ids.length} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onChange={event => onVisibility(ids, event.target.checked)} />
    <span className="visibility-checkbox-icon" aria-hidden="true"><LineIcon name={checked ? "square-to-confirm-square-twotone-transition" : "confirm-square-twotone-to-square-transition"} size={24} /></span>
  </label>;
}

export const StructureTree = memo(function StructureTree(props: TreeProps) {
  const { t } = useLanguage();
  const { targets, children } = useMemo(() => {
    const result = indexCatalog(props.catalog);
    result.children.get(undefined)?.sort((a, b) => systemOrder.indexOf(a.group_id) - systemOrder.indexOf(b.group_id));
    return result;
  }, [props.catalog]);
  const structures = useMemo(() => new Map(props.structures.map(part => [part.source_id, part])), [props.structures]);
  const revealPath = useMemo(() => {
    const path = new Set<string>();
    const id = props.reveal?.id;
    if (!id) return path;
    let target = props.catalog.targets.find(target => structureIds(target).includes(id)
      && !(children.get(target.id) ?? []).some(child => child.structure_ids.includes(id)));
    while (target) {
      path.add(target.id);
      const parent = target.parent_id;
      target = parent === undefined ? undefined : targets.get(parent);
    }
    return path;
  }, [props.catalog, props.reveal, targets, children]);
  const revealRow = useCallback((element: HTMLLIElement | null) => {
    if (element && window.matchMedia("(min-width: 901px)").matches) element.scrollIntoView({ block: "nearest" });
  }, [props.reveal]);
  return <nav aria-label={t("tree.navigation.label")}><ul className="structure-tree">
    {(children.get(undefined) ?? []).map(target => <Folder key={target.id} target={target} childrenById={children} structures={structures} props={props} revealPath={revealPath} revealRow={revealRow} />)}
  </ul></nav>;
});

function Folder({ target, childrenById, structures, props, revealPath, revealRow }: {
  target: StudyTarget; childrenById: Map<string | undefined, StudyTarget[]>; structures: Map<string, Structure>; props: TreeProps;
  revealPath: Set<string>; revealRow: (element: HTMLLIElement | null) => void;
}) {
  const { language, t } = useLanguage();
  const [open, setOpen] = useState(() => revealPath.has(target.id));
  useEffect(() => { if (revealPath.has(target.id)) setOpen(true); }, [revealPath, target.id]);
  const children = childrenById.get(target.id) ?? [];
  // System toggles follow Blender display collections; subfolders retain anatomical cross-references.
  const ids = structureIds(target);
  const directIds = useMemo(() => {
    const nestedIds = new Set((childrenById.get(target.id) ?? []).flatMap(child => child.structure_ids));
    return structureIds(target).filter(id => !nestedIds.has(id));
  }, [target, childrenById]);
  const otherLanguage = language === "vi" ? "en" : "vi";
  const title = targetName(target, language);
  const otherName = targetName(target, otherLanguage);
  const focusFolder = () => {
    if (!props.disabled && ids.length) props.onFocus(ids, target.id);
  };
  return <li data-target-id={target.id}>
    <div className={`tree-row folder-row${props.targetId === target.id ? " is-selected" : ""}`} onDoubleClick={focusFolder}>
      <button className="folder-toggle" aria-label={t(open ? "tree.close" : "tree.open", { name: title })} aria-expanded={open}
        onClick={() => setOpen(!open)} onDoubleClick={event => event.stopPropagation()}>
        <LineIcon name={open ? "chevron-small-down" : "chevron-small-right"} size={24} />
      </button>
      {ids.length > 0
        ? <VisibilityCheckbox ids={ids} label={title} {...props} />
        : <span className="tree-no-model" aria-hidden="true">—</span>}
      <button className="tree-name" onClick={() => props.onTarget(target.id)} aria-current={props.targetId === target.id ? "true" : undefined}
        aria-keyshortcuts={ids.length ? "Shift+Enter" : undefined} title={ids.length ? `Nhấp đúp hoặc Shift+Enter để phóng tới ${title}` : undefined}
        onKeyDown={event => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); focusFolder(); } }}>
        {title}{otherName !== title && <small lang={otherLanguage}>{otherName}</small>}
      </button>
      <small className="tree-count">{ids.length
          ? <><span>{ids.length}</span>{" "}<span>{t(language === "en" && ids.length === 1 ? "tree.structureCount.one" : "tree.structureCount.other")}</span></>
          : t("tree.noModel")}</small>
    </div>
    {open && <ul>
      {children.map(child => <Folder key={child.id} target={child} childrenById={childrenById} structures={structures} props={props} revealPath={revealPath} revealRow={revealRow} />)}
      {directIds.map(id => {
        const part = structures.get(id);
        if (!part) return null;
        const title = structureName(part, language);
        const otherName = structureName(part, otherLanguage);
        return <li key={id} ref={props.reveal?.id === id && revealPath.has(target.id) ? revealRow : undefined}
          className={`tree-row part-row${props.selected === id ? " is-selected" : ""}`} data-structure-id={id}
          onDoubleClick={() => { if (!props.disabled) props.onFocus([id]); }}>
          <VisibilityCheckbox ids={[id]} label={title} {...props} />
          <button className="tree-name" disabled={props.disabled} aria-current={props.selected === id ? "true" : undefined}
            aria-keyshortcuts="Shift+Enter" title={t("tree.focusHint", { name: title })}
            onKeyDown={event => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); props.onFocus([id]); } }}
            onClick={() => props.onSelect(id)} onFocus={event => {
              if (event.currentTarget.closest<HTMLElement>(".study-shell")?.dataset.focusSource === "keyboard") props.onSelect(id);
            }}>{title}
            {otherName !== title && <small lang={otherLanguage}>{otherName}</small>}</button>
        </li>;
      })}
    </ul>}
  </li>;
}
