import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Catalog } from "../../catalog/types";
import { StructureSearch, useStructureSearch } from "../../anatomy/structure-search";
import { StructureTree } from "../../anatomy/structure-tree";
import { useLanguage } from "../../i18n";
import { fetchModelMetadata, modelMetadataPath, requireRootMetadata } from "../../model-assets";

type ModelMetadata = { metadata?: Record<string, unknown> };

export function metadataForRoot(payload: ModelMetadata, rootId: string) {
  return payload.metadata ? requireRootMetadata(payload.metadata, rootId) : payload;
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
  const { t } = useLanguage();
  const [metadata, setMetadata] = useState<{ catalog: Catalog; ready: boolean }>();
  const [query, setQuery] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  const closeSettings = useEffectEvent(onCloseSettings);
  const ready = metadata?.catalog === catalog && metadata.ready;
  const failed = metadata?.catalog === catalog && !metadata.ready;

  useEffect(() => {
    if (!settingsOpen) {
      setQuery("");
      return;
    }
    const host = cancelButton.current?.closest<HTMLElement>(".lesson-model-settings");
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
    if (!settingsOpen || ready || failed) return;
    const abort = new AbortController();
    const downloads = new Map<string, Promise<ModelMetadata>>();
    void Promise.all(catalog.roots.map(async root => {
      const path = modelMetadataPath(root.model!.path);
      let download = downloads.get(path);
      if (!download) {
        download = fetchModelMetadata<ModelMetadata>(path, { signal: abort.signal });
        downloads.set(path, download);
      }
      return [root, JSON.stringify(metadataForRoot(await download, root.id))] as const;
    })).then(entries => {
      if (abort.signal.aborted) return;
      for (const [root, json] of entries) catalog.ingestMetadata(root, json);
      catalog.finish();
      setMetadata({ catalog, ready: true });
    }).catch(error => {
      if (abort.signal.aborted) return;
      abort.abort();
      console.error("Lesson structure search failed", error);
      setMetadata({ catalog, ready: false });
    });
    return () => abort.abort();
  }, [catalog, failed, ready, settingsOpen]);

  const shown = useMemo(() => new Set(visibleIds), [visibleIds]);
  const reveal = useMemo(() => selectedPart || targetId ? { id: selectedPart || targetId } : undefined, [selectedPart, targetId]);
  const search = useStructureSearch(catalog, query, settingsOpen && ready);

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
      <div className="lesson-inspector-actions">
        <button className="lesson-button" disabled={!ready}
          onClick={() => onChangeScene([...new Set(catalog.roots.flatMap(root => catalog.members(root.id)))])}>{t("catalog.showAll")}</button>
        <button className="lesson-button" disabled={!ready || !visibleIds.length} onClick={() => onChangeScene([])}>{t("catalog.hideAll")}</button>
        <button className="lesson-button" disabled={!ready || !targetId} onClick={() => onChangeScene(catalog.members(targetId))}>{t("lessons.resetScene")}</button>
      </div>
      <StructureSearch query={query} onChange={setQuery} disabled={!ready} empty={!!search && !search.bestId} />
      {!ready && !failed && <p aria-live="polite">{t("lessons.loadingStructures")}</p>}
      {failed && <p role="alert">{t("lessons.targetError")} <button className="lesson-save-retry" onClick={() => setMetadata(undefined)}>{t("lessons.retry")}</button></p>}
      {ready && <StructureTree catalog={catalog} visibleIds={shown} selected={selectedPart ?? ""}
        targetId={catalog.target(selectedPart ?? "") ? selectedPart : targetId} reveal={reveal} disabled={false}
        search={search}
        onVisibility={changeVisibility} onSelect={onSelectPart} onTarget={id => onSelectPart(id, true)}
        onFocus={(members, target) => onChangeScene(target ? catalog.members(target) : members)} />}
    </div>
    <div className="lesson-model-settings-controls">{controls}</div>
  </>;
}
