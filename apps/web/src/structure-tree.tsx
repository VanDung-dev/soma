import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, StudyTarget } from "./core";
import type { Structure } from "./model-viewer";
import { structureName, targetName } from "./anatomy-names";

const systemOrder = [
  "group:skeletal-system", "group:muscular-insertions", "group:joints",
  "group:lymphoid-organs", "group:cardiovascular-system", "group:nervous-system",
  "group:visceral-systems", "group:muscular-system", "group:body-regions",
];

interface TreeProps {
  catalog: Catalog;
  structures: Structure[];
  visibleIds: Set<string>;
  selected: string;
  targetId?: string;
  reveal?: { id: string };
  disabled: boolean;
  onVisibility: (ids: string[], shown: boolean) => void;
  onSelect: (id: string) => void;
  onTarget: (id: string) => void;
  onFocus: (ids: string[], targetId?: string, revealFolder?: boolean) => void;
}

export function Magnifier() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="10" cy="10" r="6" /><path d="m14.5 14.5 5 5" />
  </svg>;
}

function VisibilityCheckbox({ ids, visibleIds, label, disabled, onVisibility }: Pick<TreeProps, "visibleIds" | "disabled" | "onVisibility"> & { ids: string[]; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.filter(id => visibleIds.has(id)).length;
  const mixed = count > 0 && count < ids.length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={`Hiện ${label}`} checked={ids.length > 0 && count === ids.length}
    disabled={disabled || !ids.length} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onChange={event => onVisibility(ids, event.target.checked)} />;
}

export function StructureTree(props: TreeProps) {
  const children = useMemo(() => {
    const result = new Map<string | undefined, StudyTarget[]>();
    for (const target of props.catalog.targets) {
      const entries = result.get(target.parent_id) ?? [];
      entries.push(target); result.set(target.parent_id, entries);
    }
    result.get(undefined)?.sort((a, b) => systemOrder.indexOf(a.group_id) - systemOrder.indexOf(b.group_id));
    return result;
  }, [props.catalog]);
  const structures = useMemo(() => new Map(props.structures.map(part => [part.source_id, part])), [props.structures]);
  const revealPath = useMemo(() => {
    const path = new Set<string>();
    const id = props.reveal?.id;
    if (!id) return path;
    let target = props.catalog.targets.find(target => (target.model?.structure_ids ?? target.structure_ids).includes(id)
      && !(children.get(target.id) ?? []).some(child => child.structure_ids.includes(id)));
    while (target) {
      path.add(target.id);
      const parent = target.parent_id;
      target = props.catalog.targets.find(target => target.id === parent);
    }
    return path;
  }, [props.catalog, props.reveal, children]);
  const revealRow = useCallback((element: HTMLLIElement | null) => {
    if (element && window.matchMedia("(min-width: 901px)").matches) element.scrollIntoView({ block: "nearest" });
  }, [props.reveal]);
  return <nav aria-label="Thư mục giải phẫu"><ul className="structure-tree">
    {(children.get(undefined) ?? []).map(target => <Folder key={target.id} target={target} childrenById={children} structures={structures} props={props} revealPath={revealPath} revealRow={revealRow} />)}
  </ul></nav>;
}

function Folder({ target, childrenById, structures, props, revealPath, revealRow }: {
  target: StudyTarget; childrenById: Map<string | undefined, StudyTarget[]>; structures: Map<string, Structure>; props: TreeProps;
  revealPath: Set<string>; revealRow: (element: HTMLLIElement | null) => void;
}) {
  const [open, setOpen] = useState(() => revealPath.has(target.id));
  useEffect(() => { if (revealPath.has(target.id)) setOpen(true); }, [revealPath, target.id]);
  const children = childrenById.get(target.id) ?? [];
  // System toggles follow Blender display collections; subfolders retain anatomical cross-references.
  const ids = target.model?.structure_ids ?? target.structure_ids;
  const nestedIds = new Set(children.flatMap(child => child.structure_ids));
  const directIds = ids.filter(id => !nestedIds.has(id));
  const title = targetName(target);
  const english = targetName(target, "en");
  // The first click selects the row before the dblclick event arrives.
  const selectedBeforeClick = useRef<boolean | undefined>(undefined);
  const focusFolder = (reveal = props.targetId !== target.id) => {
    selectedBeforeClick.current = undefined;
    if (!props.disabled && ids.length) props.onFocus(ids, target.id, reveal);
  };
  return <li data-target-id={target.id}>
    <div className={`tree-row folder-row${props.targetId === target.id ? " is-selected" : ""}`}
      onClickCapture={event => { if (event.detail === 1) selectedBeforeClick.current = props.targetId === target.id; }}
      onDoubleClick={() => {
        focusFolder(!(selectedBeforeClick.current ?? (props.targetId === target.id)));
      }}>
      <button className="folder-toggle" aria-label={`${open ? "Đóng" : "Mở"} ${title}`} aria-expanded={open}
        onClick={() => setOpen(!open)} onDoubleClick={event => event.stopPropagation()}>{open ? "▾" : "▸"}</button>
      {ids.length > 0
        ? <VisibilityCheckbox ids={ids} label={title} {...props} />
        : <span className="tree-no-model" aria-hidden="true">—</span>}
      <button className="tree-name" onClick={() => props.onTarget(target.id)} aria-current={props.targetId === target.id ? "true" : undefined}
        aria-keyshortcuts={ids.length ? "Shift+Enter" : undefined} title={ids.length ? `Nhấp đúp hoặc Shift+Enter để phóng tới ${title}` : undefined}
        onKeyDown={event => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); focusFolder(); } }}>
        {title}{english !== title && <small lang="en">{english}</small>}
      </button>
      <small className="tree-count">{ids.length
          ? <><span>{ids.length}</span>{" "}<span>cấu trúc</span></>
          : "Chưa có mô hình"}</small>
    </div>
    {open && <ul>
      {children.map(child => <Folder key={child.id} target={child} childrenById={childrenById} structures={structures} props={props} revealPath={revealPath} revealRow={revealRow} />)}
      {directIds.map(id => {
        const part = structures.get(id);
        if (!part) return null;
        const title = structureName(part);
        const english = structureName(part, "en");
        return <li key={id} ref={props.reveal?.id === id && revealPath.has(target.id) ? revealRow : undefined}
          className={`tree-row part-row${props.selected === id ? " is-selected" : ""}`} data-structure-id={id}
          onDoubleClick={() => { if (!props.disabled) props.onFocus([id]); }}>
          <VisibilityCheckbox ids={[id]} label={title} {...props} />
          <button className="tree-name" disabled={props.disabled} aria-current={props.selected === id ? "true" : undefined}
            aria-keyshortcuts="Shift+Enter" title={`Nhấp đúp hoặc Shift+Enter để phóng tới ${title}`}
            onKeyDown={event => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); props.onFocus([id]); } }}
            onClick={() => props.onSelect(id)} onFocus={() => props.onSelect(id)}>{title}
            {english !== title && <small lang="en">{english}</small>}</button>
        </li>;
      })}
    </ul>}
  </li>;
}
