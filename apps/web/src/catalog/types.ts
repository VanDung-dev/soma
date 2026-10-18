export interface Catalog {
  schema_version: number;
  groups: { id: string; title: string }[];
  targets: StudyTarget[];
}

export interface StudyTarget {
  id: string;
  title: string;
  source_name: string;
  group_id: string;
  parent_id?: string;
  structure_ids: string[];
  model?: Model;
}

export interface Model { path: string; scope: string; structure_ids: string[] }

export interface Structure {
  source_id: string;
  source_name: string;
  source_object: string;
  latin: string;
  laterality: string;
  collections: string[];
}
