import type { Catalog, StudyTarget } from "./types";

export function structureIds(target: StudyTarget) {
  // Display-system membership and anatomical cross-references are distinct in the source.
  return target.model?.structure_ids ?? target.structure_ids;
}

export function indexCatalog(catalog: Catalog) {
  const targets = new Map(catalog.targets.map(target => [target.id, target]));
  const children = new Map<string | undefined, StudyTarget[]>();
  for (const target of catalog.targets) {
    const entries = children.get(target.parent_id) ?? [];
    entries.push(target);
    children.set(target.parent_id, entries);
  }
  return { targets, children, roots: (children.get(undefined) ?? []).filter(target => target.model) };
}
