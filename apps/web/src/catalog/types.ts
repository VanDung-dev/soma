export type { Catalog } from "./index";
export type LessonSceneVisibilityEdit =
  | { kind: "toggle"; ids: string[]; shown: boolean; target?: string }
  | { kind: "hide"; ids: string[] }
  | { kind: "showAll" }
  | { kind: "hideAll" }
  | { kind: "focus"; ids: string[]; target?: string };
export interface AnatomyNames { vi: string; en: string }
export interface OpenStaxReference { url: string; names: AnatomyNames }

export interface StudyTarget {
  id: string;
  source_name: string;
  names: AnatomyNames;
  count: number;
  parent_id?: string;
  model?: Model;
}

export interface Model { path: string; scope: string; sha256: string }

export interface ModelBundlePlan { path: string; sha256: string; metadataPath: string; rootIds: string[] }
export interface ModelLoadPlan {
  bundle?: ModelBundlePlan;
  requestedCount: number;
  loadedCount: number;
  explosionGroups: string[][];
}

export interface Structure {
  source_id: string;
  source_name: string;
  source_object: string;
  latin: string;
  laterality: string;
  collections: string[];
}

export interface StructureRow { source_id: string; names: AnatomyNames; latin: string }
export interface StructureDetail extends Structure { names: AnatomyNames; collection_names: AnatomyNames[] }
export interface FolderView { target: StudyTarget; visible: number; children: FolderView[]; structures: StructureRow[]; more: boolean; limit: number; total: number }
export type SearchRow = StructureRow | StudyTarget;
export interface SearchPage { total: number; items: SearchRow[] }
export interface TreeSearchResult {
  bestId?: string;
  folders: string[];
  structures: Record<string, string>;
  initialOpen: string[];
  limits: Record<string, number>;
  highlights: Record<string, [start: number, end: number]>;
}
