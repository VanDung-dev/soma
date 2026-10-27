export type { Catalog } from "./index";
export interface AnatomyNames { vi: string; en: string }

export interface StudyTarget {
  id: string;
  source_name: string;
  names: AnatomyNames;
  count: number;
  parent_id?: string;
  model?: Model;
}

export interface Model { path: string; scope: string }

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
export interface SearchPage { total: number; items: StructureRow[] }
