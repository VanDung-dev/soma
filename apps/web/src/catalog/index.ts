import type { CatalogData } from "../content/content";
import type { FolderView, OpenStaxReference, SearchPage, StructureDetail, StudyTarget, TreeSearchResult } from "./types";

export class Catalog {
  readonly roots: StudyTarget[];
  readonly groupCount: number;
  constructor(private data: CatalogData) { this.roots = data.roots(); this.groupCount = data.group_count(); }
  target(id: string): StudyTarget | undefined { return this.data.target(id); }
  members(id: string): string[] { return this.data.members(id) ?? []; }
  clearMetadata() { this.data.clear_metadata(); }
  ingestMetadata(root: StudyTarget, json: string): string[] { return this.data.ingest_metadata(root.id, json); }
  finish() { this.data.finish(); }
  identities(): string[] { return this.data.identities(); }
  detail(id: string): StructureDetail | undefined { return this.data.detail(id); }
  openstaxReference(id: string): OpenStaxReference | undefined { return this.data.openstax_reference(id); }
  search(query: string, language: string, limit: number): SearchPage { return this.data.search(query, language, limit); }
  searchTree(query: string, language: string): TreeSearchResult | undefined { return this.data.search_tree(query, language); }
  searchTargets(query: string, language: string, limit: number, ids: readonly string[]): SearchPage {
    return this.data.search_targets(query, language, limit, ids);
  }
  searchStructures(query: string, language: string, limit: number, ids: readonly string[]): SearchPage {
    return this.data.search_structures(query, language, limit, ids);
  }
  reveal(id: string): [string, number][] { return this.data.reveal(id); }
  tree(open: string[], limits: Record<string, number>, visible: string[]): FolderView[] { return this.data.tree(open, limits, visible); }
  free() { this.data.free(); }
}
