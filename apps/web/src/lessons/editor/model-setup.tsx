import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import { StructureTree } from "../../anatomy/structure-tree";
import { useLanguage } from "../../i18n";
import { fetchModelAsset } from "../../model-assets";
import { searchLessonTree } from "./tree-search";

export function metadataForRoot(payload: { metadata?: Record<string, unknown> }, rootId: string) {
  if (!payload.metadata) return payload;
  const metadata = payload.metadata[rootId];
  if (!metadata) throw new Error("Missing system metadata");
  return metadata;
}

export function LessonModelSetup({ catalog, targetId, visibleIds, selectedPart, settingsOpen, controls, onCloseSettings, onApply, onChangeScene, onSelectPart }: {
  catalog: Catalog;
  targetId: string;
  visibleIds: string[];
  selectedPart?: string;
  settingsOpen: boolean;
  controls: ReactNode;
  onCloseSettings: () => void;
  onApply: () => void;
  onChangeScene: (ids: string[], root?: { id: string; shown: boolean }) => boolean;
  onSelectPart: (id: string, target?: boolean) => void;
}) {
  const { language, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  const closeSettings = useEffectEvent(onCloseSettings);

  useEffect(() => {
    if (!settingsOpen) {
      setQuery("");
      return;
    }
    const host = cancelButton.current?.closest(".lesson-model-settings");
    if (!host) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    };
    host.addEventListener("keydown", onKeyDown);
    const frame = requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 900px)").matches) host.scrollIntoView({ block: "start", inline: "nearest" });
      cancelButton.current?.focus({ preventScroll: true });
    });
    return () => { cancelAnimationFrame(frame); host.removeEventListener("keydown", onKeyDown); };
  }, [settingsOpen]);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setFailed(false);
    void Promise.all(catalog.roots.map(async root => {
      const response = await fetchModelAsset(root.model!.path.replace(/\.glb(?:\.br)?$/, ".json"), { signal: abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { metadata?: Record<string, unknown> };
      if (!abort.signal.aborted) catalog.ingestMetadata(root, JSON.stringify(metadataForRoot(payload, root.id)));
    })).then(() => {
      if (!abort.signal.aborted) { catalog.finish(); setLoading(false); }
    }, error => {
      if (!abort.signal.aborted) { console.error("Lesson structure search failed", error); setFailed(true); setLoading(false); }
    });
    return () => abort.abort();
  }, [catalog, attempt]);

  const shown = useMemo(() => new Set(visibleIds), [visibleIds]);
  const reveal = useMemo(() => selectedPart || targetId ? { id: selectedPart || targetId } : undefined, [selectedPart, targetId]);
  const ready = !loading && !failed;
  const searchTerm = query.trim();
  const search = useMemo(() => settingsOpen && ready && searchTerm
    ? searchLessonTree(catalog, searchTerm, language) : undefined, [catalog, language, ready, searchTerm, settingsOpen]);

  function changeVisibility(members: string[], visible: boolean, target?: string) {
    const next = new Set(visibleIds);
    for (const id of members) {
      if (visible) next.add(id);
      else next.delete(id);
    }
    const root = target && catalog.roots.some(root => root.id === target) ? { id: target, shown: visible } : undefined;
    return onChangeScene([...next], root);
  }

  return <>
    <header className="guide-heading"><h2 id="lesson-model-settings-title">{t("lessons.modelSettings")}</h2>
      <div className="lesson-model-settings-actions">
        <button className="lesson-button" ref={cancelButton} onClick={onCloseSettings}>{t("lessons.cancel")}</button>
        <button className="lesson-button lesson-primary" disabled={!ready} onClick={onApply}>{t("lessons.apply")}</button>
      </div>
    </header>
    <div className="catalog-tree lesson-scene-tree">
      <h3>{t("lessons.sceneStructures")}</h3>
      <div className="lesson-inspector-actions">
        <button className="lesson-button" disabled={!ready}
          onClick={() => onChangeScene([...new Set(catalog.roots.flatMap(root => catalog.members(root.id)))])}>{t("catalog.showAll")}</button>
        <button className="lesson-button" disabled={!ready || !visibleIds.length} onClick={() => onChangeScene([])}>{t("catalog.hideAll")}</button>
        <button className="lesson-button" disabled={!ready || !targetId} onClick={() => onChangeScene(catalog.members(targetId))}>{t("lessons.resetScene")}</button>
      </div>
      <div className="lesson-scene-search" role="search" aria-label={t("search.label")}>
        <input type="search" aria-label={t("search.label")} placeholder={t("search.label")} autoComplete="off"
          disabled={!ready} value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      {loading && <p aria-live="polite">{t("lessons.loadingStructures")}</p>}
      {failed && <p role="alert">{t("lessons.targetError")} <button className="lesson-save-retry" onClick={() => setAttempt(value => value + 1)}>{t("lessons.retry")}</button></p>}
      {ready && <>
        {search && !search.bestId && <p aria-live="polite">{t("search.noResults")}</p>}
        <StructureTree catalog={catalog} visibleIds={shown} selected={selectedPart ?? ""}
          targetId={catalog.target(selectedPart ?? "") ? selectedPart : targetId} reveal={reveal} disabled={false}
          search={search}
          onVisibility={changeVisibility} onSelect={onSelectPart} onTarget={id => onSelectPart(id, true)}
          onFocus={(members, target) => onChangeScene(target ? catalog.members(target) : members)} />
      </>}
    </div>
    <div className="lesson-model-settings-controls">{controls}</div>
  </>;
}
