import type { Catalog, FolderView, StudyTarget } from "../../anatomy/catalog/types";
import type { Lesson } from "./contract";

export function lessonModels(catalog: Catalog, lesson: Lesson): string[] {
  const initial = lesson.modelIds?.length ? lesson.modelIds : (lesson.modelId ? [lesson.modelId] : []);
  if (!initial.length) return [];
  const scenes = [...(lesson.scene ? [lesson.scene] : []), ...lesson.steps.filter(step => step.kind !== "text")];
  const needed = new Set(scenes.flatMap(scene => scene.visibleIds ?? catalog.members(scene.targetId)));
  const models = [...initial];
  for (const mid of initial) {
    catalog.members(mid).forEach(id => needed.delete(id));
  }
  for (const root of catalog.roots) {
    if (models.includes(root.id)) continue;
    const ids = catalog.members(root.id);
    if (!ids.some(id => needed.has(id))) continue;
    models.push(root.id);
    ids.forEach(id => needed.delete(id));
  }
  return models;
}

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
