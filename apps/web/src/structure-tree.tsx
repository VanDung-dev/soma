import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalog, StudyTarget } from "./core";
import type { Structure } from "./model-viewer";

interface TreeProps {
  catalog: Catalog;
  structures: Structure[];
  visibleIds: Set<string>;
  selected: string;
  targetId?: string;
  disabled: boolean;
  onVisibility: (ids: string[], shown: boolean) => void;
  onSelect: (id: string) => void;
  onTarget: (id: string) => void;
}

function VisibilityCheckbox({ ids, visibleIds, label, disabled, onVisibility }: Pick<TreeProps, "visibleIds" | "disabled" | "onVisibility"> & { ids: string[]; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.filter(id => visibleIds.has(id)).length;
  const mixed = count > 0 && count < ids.length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={`Hiện ${label}`} checked={ids.length > 0 && count === ids.length}
    disabled={disabled || !ids.length} onClick={event => event.stopPropagation()} onChange={event => onVisibility(ids, event.target.checked)} />;
}

export function StructureTree(props: TreeProps) {
  const children = useMemo(() => {
    const result = new Map<string | undefined, StudyTarget[]>();
    for (const target of props.catalog.targets) {
      const entries = result.get(target.parent_id) ?? [];
      entries.push(target); result.set(target.parent_id, entries);
    }
    return result;
  }, [props.catalog]);
  const structures = useMemo(() => new Map(props.structures.map(part => [part.source_id, part])), [props.structures]);
  return <nav aria-label="Thư mục giải phẫu"><ul className="structure-tree">
    {(children.get(undefined) ?? []).map(target => <Folder key={target.id} target={target} childrenById={children} structures={structures} props={props} />)}
  </ul></nav>;
}

function Folder({ target, childrenById, structures, props }: { target: StudyTarget; childrenById: Map<string | undefined, StudyTarget[]>; structures: Map<string, Structure>; props: TreeProps }) {
  const [open, setOpen] = useState(false);
  const children = childrenById.get(target.id) ?? [];
  const nestedIds = new Set(children.flatMap(child => child.structure_ids));
  const directIds = target.structure_ids.filter(id => !nestedIds.has(id));
  return <li data-target-id={target.id}>
    <div className={`tree-row folder-row${props.targetId === target.id ? " is-selected" : ""}`}>
      <button className="folder-toggle" aria-label={`${open ? "Đóng" : "Mở"} ${target.title}`} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>
      {target.structure_ids.length > 0
        ? <VisibilityCheckbox ids={target.structure_ids} label={target.title} {...props} />
        : <span className="tree-no-model" aria-hidden="true">—</span>}
      <button className="tree-name" onClick={() => props.onTarget(target.id)} aria-current={props.targetId === target.id ? "true" : undefined}>
        <span aria-hidden="true">▱ </span>{target.title}<small>{target.structure_ids.length ? `${target.structure_ids.length} cấu trúc` : "Chỉ có tài liệu · Không có mô hình"}</small>
      </button>
    </div>
    {open && <ul>
      {children.map(child => <Folder key={child.id} target={child} childrenById={childrenById} structures={structures} props={props} />)}
      {directIds.map(id => {
        const part = structures.get(id);
        if (!part) return null;
        const title = part.source_name + (part.laterality === "left" ? " · trái" : part.laterality === "right" ? " · phải" : "");
        return <li key={id} className={`tree-row part-row${props.selected === id ? " is-selected" : ""}`} data-structure-id={id}>
          <VisibilityCheckbox ids={[id]} label={title} {...props} />
          <button className="tree-name" disabled={props.disabled} aria-current={props.selected === id ? "true" : undefined}
            onClick={() => props.onSelect(id)} onFocus={() => props.onSelect(id)}>{title}</button>
        </li>;
      })}
    </ul>}
  </li>;
}
