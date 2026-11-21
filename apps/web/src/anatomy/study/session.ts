import type { Catalog } from "../catalog/types";
import type { CameraCommand, SceneView, StudyViewer, ViewerState } from "../viewer/contracts";

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

export function canReadStructure(state: Pick<ViewerState, "movingId" | "separatedIds">, id: string) {
  return !!id && (id === state.movingId || state.separatedIds.has(id));
}

export class StudySession {
  private viewer: StudyViewer | undefined;
  private listeners = new Set<() => void>();
  private history: NavigationEntry[] = [{ kind: "overview" }];
  private historyIndex = 0;
  private navigating = false;
  private state: StudyState = {
    building: true, loadedSystems: 0, status: "loading", error: false, structureIds: [],
    selected: "", movingId: "", separatedIds: new Set(), focusedIds: [], readingId: "", visibleIds: new Set(), readerExpanded: false, explosionAmount: 0,
    canGoBack: false, canGoForward: false,
  };

  constructor(readonly catalog: Catalog) {}

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

  updateViewer = (patch: Partial<ViewerState>, visibleIds?: ReadonlySet<string>) => {
    const movingId = patch.movingId ?? this.state.movingId;
    const separatedIds = patch.separatedIds ?? this.state.separatedIds;
    const readerWasAvailable = canReadStructure(this.state, this.state.readingId) || !!this.state.targetId;
    const readerRemainsAvailable = !!this.state.targetId || canReadStructure({ movingId, separatedIds }, this.state.readingId);
    this.update({ ...patch, ...(patch.structureIds ? { visibleIds: visibleIds ?? new Set(patch.structureIds) } : {}),
      ...(readerWasAvailable && !readerRemainsAvailable ? { readerExpanded: false } : {}) });
  };

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
    if (entry.kind !== "overview") this.revealStructure(entry.id);
    return true;
  }

  back = () => this.navigate(-1);
  forward = () => this.navigate(1);

  browseStructure = (id: string) => {
    if (!this.viewer?.select(id)) return false;
    this.update({ readingId: id, readerExpanded: canReadStructure(this.state, id) && this.state.readerExpanded,
      targetId: undefined, focusedIds: [], ...this.record({ kind: "structure", id, focused: false }) });
    this.retargetExplosion();
    return true;
  };

  browseTarget = (id: string) => {
    if (!this.catalog.target(id) || !this.viewer?.select("")) return false;
    this.update({ readingId: "", readerExpanded: false, targetId: id, focusedIds: [], ...this.record({ kind: "target", id, focused: false }) });
    this.retargetExplosion();
    return true;
  };

  pick = (id: string) => {
    this.update({ readingId: id, readerExpanded: canReadStructure(this.state, id) && this.state.readerExpanded, targetId: undefined, focusedIds: [],
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

  restoreHiddenIds = (ids: string[]) => {
    const hidden = new Set(ids.filter(id => this.state.structureIds.includes(id)));
    const toHide = [...this.state.visibleIds].filter(id => hidden.has(id));
    if (toHide.length && !this.viewer?.changeVisibility(toHide, false)) return false;
    this.update({ visibleIds: new Set(this.state.structureIds.filter(id => !hidden.has(id))) });
    return true;
  };

  showScene = (ids: string[]) => {
    if (!ids.every(id => this.state.structureIds.includes(id))) return false;
    const success = ids.length
      ? this.viewer?.focus(ids, true, !ids.every(id => this.state.visibleIds.has(id)))
      : this.viewer?.changeVisibility(this.state.structureIds, false);
    if (!success) return false;
    this.update({ visibleIds: new Set(ids), readingId: "", readerExpanded: false, targetId: undefined, focusedIds: ids });
    this.retargetExplosion();
    return true;
  };

  captureView = () => {
    const view = this.viewer?.captureView();
    return view ? { ...view, explosion: this.state.explosionAmount } : undefined;
  };

  applyScene = (ids: string[], view?: SceneView) => {
    if (new Set(ids).size !== ids.length || !ids.every(id => this.state.structureIds.includes(id))) return false;
    if (!this.viewer?.applyScene(ids, view)) return false;
    this.update({ visibleIds: new Set(ids), readingId: "", readerExpanded: false, targetId: undefined,
      focusedIds: ids, explosionAmount: view?.explosion ?? 0 });
    return true;
  };

  focus = (requestedIds: string[], targetId?: string) => {
    const target = targetId ? this.catalog.target(targetId) : undefined;
    if (targetId && !target) return false;
    const ids = target ? this.catalog.members(target.id) : requestedIds;
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
      visibleIds: new Set(this.state.structureIds), explosionAmount: 0, ...this.record({ kind: "overview" }) });
    return true;
  };

  control = (commands: CameraCommand[]) => this.viewer?.control(commands) ?? false;
}
