import type { Catalog, FolderView, StudyTarget } from "../../anatomy/catalog/types";
import type { Lesson, LessonScene } from "./contract";

export function lessonSceneModels(catalog: Catalog, lesson: Lesson, scene?: LessonScene): string[] {
  if (scene?.modelIds !== undefined) return scene.modelIds;
  const initial = lesson.modelIds?.length ? lesson.modelIds : (lesson.modelId ? [lesson.modelId] : []);
  const models = [...initial];
  const needed = new Set(scene ? scene.visibleIds ?? catalog.members(scene.targetId) : []);
  for (const mid of models) {
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

export function lessonModels(catalog: Catalog, lesson: Lesson): string[] {
  const scenes = [...(lesson.scene ? [lesson.scene] : []), ...lesson.steps.filter(step => step.kind !== "text")];
  return [...new Set([
    ...lessonSceneModels(catalog, lesson),
    ...scenes.flatMap(scene => lessonSceneModels(catalog, lesson, scene)),
  ])];
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
