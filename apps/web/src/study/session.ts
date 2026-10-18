import type { Catalog } from "../catalog/types";
import { indexCatalog, structureIds } from "../catalog";
import type { CameraCommand, StudyViewer, ViewerState } from "../viewer/contracts";

export interface StudyState extends ViewerState {
  targetId?: string;
  focusedIds: string[];
  readingId: string;
  visibleIds: ReadonlySet<string>;
  readerExpanded: boolean;
  explosionAmount: number;
  reveal?: { id: string };
}

export class StudySession {
  readonly catalog;
  private viewer: StudyViewer | undefined;
  private listeners = new Set<() => void>();
  private state: StudyState = {
    building: true, loadedSystems: 0, status: "Đang nạp mô hình…", error: false, meshes: [],
    selected: "", hovered: "", focusedIds: [], readingId: "", visibleIds: new Set(), readerExpanded: false, explosionAmount: 0,
  };

  constructor(catalog: Catalog) { this.catalog = indexCatalog(catalog); }

  getSnapshot = (): Readonly<StudyState> => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  connect(viewer: StudyViewer) { this.viewer = viewer; }
  disconnect(viewer: StudyViewer) { if (this.viewer === viewer) this.viewer = undefined; }

  private update(patch: Partial<StudyState>) {
    if (Object.entries(patch).every(([key, value]) => Object.is(this.state[key as keyof StudyState], value))) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  updateViewer = (patch: Partial<ViewerState>) => {
    this.update(patch.meshes ? { ...patch, visibleIds: new Set(patch.meshes.map(part => part.source_id)) } : patch);
  };

  private explosionIds() { return this.state.readingId ? [this.state.readingId] : this.state.focusedIds; }
  private retargetExplosion() { this.viewer?.retargetExplosion(this.state.explosionAmount, this.explosionIds()); }

  browseStructure = (id: string) => {
    this.viewer?.select(id);
    this.update({ readingId: id, targetId: undefined, focusedIds: [] });
    this.retargetExplosion();
  };

  browseTarget = (id: string) => {
    this.viewer?.select("");
    this.update({ readingId: "", targetId: id, focusedIds: [] });
    this.retargetExplosion();
  };

  pick = (id: string) => {
    this.update({ readingId: id, targetId: undefined, focusedIds: [] });
    this.retargetExplosion();
  };

  changeVisibility = (ids: string[], shown: boolean) => {
    if (!this.viewer?.changeVisibility(ids, shown)) return false;
    const visibleIds = new Set(this.state.visibleIds);
    for (const id of ids) { if (shown) visibleIds.add(id); else visibleIds.delete(id); }
    this.update({ visibleIds });
    return true;
  };

  focus = (requestedIds: string[], targetId?: string) => {
    const target = targetId ? this.catalog.targets.get(targetId) : undefined;
    if (targetId && !target) return false;
    const ids = target ? structureIds(target) : requestedIds;
    const folder = !!targetId;
    const reveal = folder && !ids.every(id => this.state.visibleIds.has(id));
    if (!ids.length || !this.viewer?.focus(ids, folder, reveal)) return false;
    const readingId = !folder && ids.length === 1 ? ids[0]! : "";
    this.update({ visibleIds: folder || readingId ? new Set(ids) : new Set([...this.state.visibleIds, ...ids]),
      readerExpanded: false, hovered: "", readingId, targetId, focusedIds: ids });
    this.retargetExplosion();
    return true;
  };

  revealStructure = (id: string) => { this.update({ reveal: { id } }); };
  toggleReader = () => { this.update({ readerExpanded: !this.state.readerExpanded }); };
  closeReader = () => { this.update({ readerExpanded: false }); };

  changeExplosion = (value: number) => {
    if (this.viewer?.setExplosion(value, this.explosionIds())) this.update({ explosionAmount: value, hovered: "" });
  };

  overview = () => {
    if (!this.viewer?.overview()) return false;
    this.update({ readerExpanded: false, readingId: "", targetId: undefined, focusedIds: [], hovered: "",
      visibleIds: new Set(this.state.meshes.map(part => part.source_id)), explosionAmount: 0 });
    return true;
  };

  control = (commands: CameraCommand[]) => this.viewer?.control(commands) ?? false;
}
