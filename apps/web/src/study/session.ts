import type { Catalog } from "../catalog/types";
import { indexCatalog, structureIds } from "../catalog";
import type { CameraCommand, StudyViewer, ViewerState } from "../viewer/contracts";

export interface StudyState extends ViewerState {
  canGoBack: boolean;
  canGoForward: boolean;
  targetId?: string;
  focusedIds: string[];
  readingId: string;
  visibleIds: ReadonlySet<string>;
  readerExpanded: boolean;
  explosionAmount: number;
  reveal?: { id: string };
}

type NavigationEntry = { kind: "overview" } | { kind: "structure" | "target"; id: string; focused: boolean };

export class StudySession {
  readonly catalog;
  private viewer: StudyViewer | undefined;
  private listeners = new Set<() => void>();
  private history: NavigationEntry[] = [{ kind: "overview" }];
  private historyIndex = 0;
  private navigating = false;
  private state: StudyState = {
    building: true, loadedSystems: 0, status: "Đang nạp mô hình…", error: false, meshes: [],
    selected: "", movingId: "", separatedIds: new Set(), focusedIds: [], readingId: "", visibleIds: new Set(), readerExpanded: false, explosionAmount: 0,
    canGoBack: false, canGoForward: false,
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
    const movingId = patch.movingId ?? this.state.movingId;
    const separatedIds = patch.separatedIds ?? this.state.separatedIds;
    const readerWasAvailable = this.canRead() || !!this.state.targetId;
    const readerRemainsAvailable = !!this.state.targetId || movingId === this.state.readingId || separatedIds.has(this.state.readingId);
    this.update({ ...patch, ...(patch.meshes ? { visibleIds: new Set(patch.meshes.map(part => part.source_id)) } : {}),
      ...(readerWasAvailable && !readerRemainsAvailable ? { readerExpanded: false } : {}) });
  };

  private canRead(id = this.state.readingId) { return !!id && (id === this.state.movingId || this.state.separatedIds.has(id)); }

  private explosionIds() { return this.state.readingId ? [this.state.readingId] : this.state.focusedIds; }
  private retargetExplosion() { this.viewer?.retargetExplosion(this.state.explosionAmount, this.explosionIds()); }

  private record(entry: NavigationEntry) {
    if (!this.navigating) {
      const current = this.history[this.historyIndex]!;
      if (current.kind === entry.kind && (current.kind === "overview" || entry.kind !== "overview" && current.id === entry.id)) {
        if (entry.kind !== "overview" && entry.focused) this.history[this.historyIndex] = entry;
      } else {
        this.history.splice(this.historyIndex + 1);
        this.history.push(entry);
        this.historyIndex++;
      }
    }
    return { canGoBack: this.historyIndex > 0, canGoForward: this.historyIndex < this.history.length - 1 };
  }

  private navigate(offset: number) {
    const index = this.historyIndex + offset;
    const entry = this.history[index];
    if (!entry) return false;
    this.navigating = true;
    let success = false;
    try {
      if (entry.kind === "overview") success = this.overview();
      else if (entry.kind === "target") success = entry.focused ? this.focus([], entry.id) : this.browseTarget(entry.id);
      else success = entry.focused ? this.focus([entry.id]) : this.browseStructure(entry.id);
    } finally { this.navigating = false; }
    if (!success) return false;
    this.historyIndex = index;
    this.update({ canGoBack: index > 0, canGoForward: index < this.history.length - 1 });
    if (entry.kind === "structure") this.revealStructure(entry.id);
    return true;
  }

  back = () => this.navigate(-1);
  forward = () => this.navigate(1);

  browseStructure = (id: string) => {
    if (!this.viewer?.select(id)) return false;
    this.update({ readingId: id, readerExpanded: this.canRead(id) && this.state.readerExpanded,
      targetId: undefined, focusedIds: [], ...this.record({ kind: "structure", id, focused: false }) });
    this.retargetExplosion();
    return true;
  };

  browseTarget = (id: string) => {
    if (!this.catalog.targets.has(id) || !this.viewer?.select("")) return false;
    this.update({ readingId: "", readerExpanded: false, targetId: id, focusedIds: [], ...this.record({ kind: "target", id, focused: false }) });
    this.retargetExplosion();
    return true;
  };

  pick = (id: string) => {
    this.update({ readingId: id, readerExpanded: this.canRead(id) && this.state.readerExpanded, targetId: undefined, focusedIds: [],
      ...(id ? this.record({ kind: "structure", id, focused: false }) : {}) });
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
      readerExpanded: false, readingId, targetId, focusedIds: ids,
      ...(targetId ? this.record({ kind: "target", id: targetId, focused: true })
        : readingId ? this.record({ kind: "structure", id: readingId, focused: true }) : {}) });
    this.retargetExplosion();
    return true;
  };

  revealStructure = (id: string) => { this.update({ reveal: { id } }); };
  toggleReader = () => { this.update({ readerExpanded: !this.state.readerExpanded }); };
  closeReader = () => { this.update({ readerExpanded: false }); };

  changeExplosion = (value: number) => {
    if (this.state.movingId || this.state.separatedIds.size) return;
    if (this.viewer?.setExplosion(value, this.explosionIds())) this.update({ explosionAmount: value });
  };

  setMoving = (id: string) => {
    if (id && (id !== this.state.selected || this.state.explosionAmount || !this.state.visibleIds.has(id))) return false;
    return this.viewer?.setMoving(id) ?? false;
  };

  restoreStructure = (id: string) => this.viewer?.restoreStructure(id) ?? false;

  overview = () => {
    if (!this.viewer?.overview()) return false;
    this.update({ readerExpanded: false, readingId: "", targetId: undefined, focusedIds: [],
      visibleIds: new Set(this.state.meshes.map(part => part.source_id)), explosionAmount: 0, ...this.record({ kind: "overview" }) });
    return true;
  };

  control = (commands: CameraCommand[]) => this.viewer?.control(commands) ?? false;
}
