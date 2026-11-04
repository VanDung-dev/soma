import type { Catalog, FolderView, StudyTarget } from "../anatomy/catalog/types";

export function lessonTargets(catalog: Catalog, modelId: string): StudyTarget[] {
  if (!modelId) return [];
  const open: string[] = [];
  let targets: StudyTarget[] = [];
  for (;;) {
    const root = catalog.tree(open, {}, []).find(folder => folder.target.id === modelId);
    if (!root) return [];
    const folders: FolderView[] = [root];
    for (let i = 0; i < folders.length; i++) folders.push(...folders[i]!.children);
    if (folders.length === open.length) return targets;
    targets = folders.map(folder => folder.target).filter(target => target.count > 0);
    open.splice(0, open.length, ...folders.map(folder => folder.target.id));
  }
}
