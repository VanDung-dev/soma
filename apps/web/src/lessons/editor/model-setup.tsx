import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Catalog, LessonSceneVisibilityEdit } from "../../catalog/types";
import { StructureSearch, useStructureSearch } from "../../catalog/structure-search";
import { StructureTree } from "../../catalog/structure-tree";
import { useLanguage } from "../../i18n";
import { loadModelMetadata } from "../../model-assets";

export function LessonModelSetup({ catalog, targetId, visibleIds, selectedPart, settingsOpen, controls, onCloseSettings, onApply, onChangeScene, onSelectPart }: {
  catalog: Catalog;
  targetId: string;
  visibleIds: string[];
  selectedPart?: string;
  settingsOpen: boolean;
  controls: ReactNode;
  onCloseSettings: () => void;
  onApply: () => void;
  onChangeScene: (edit: LessonSceneVisibilityEdit) => boolean;
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
    void loadModelMetadata(catalog, abort.signal).then(() => {
      if (abort.signal.aborted) return;
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
          onClick={() => onChangeScene({ kind: "showAll" })}>{t("catalog.showAll")}</button>
        <button className="lesson-button" disabled={!ready || !visibleIds.length} onClick={() => onChangeScene({ kind: "hideAll" })}>{t("catalog.hideAll")}</button>
        <button className="lesson-button" disabled={!ready || !targetId} onClick={() => onChangeScene({ kind: "focus", ids: [], target: targetId })}>{t("lessons.resetScene")}</button>
      </div>
      <StructureSearch query={query} onChange={setQuery} disabled={!ready} empty={!!search && !search.bestId} />
      {!ready && !failed && <p aria-live="polite">{t("lessons.loadingStructures")}</p>}
      {failed && <p role="alert">{t("lessons.targetError")} <button className="lesson-save-retry" onClick={() => setMetadata(undefined)}>{t("lessons.retry")}</button></p>}
      {ready && <StructureTree catalog={catalog} visibleIds={shown} selected={selectedPart ?? ""}
        targetId={catalog.target(selectedPart ?? "") ? selectedPart : targetId} reveal={reveal} disabled={false}
        search={search}
        onVisibility={(ids, shown, target) => onChangeScene({ kind: "toggle", ids, shown, target })}
        onSelect={onSelectPart} onTarget={id => onSelectPart(id, true)}
        onFocus={(ids, target) => onChangeScene({ kind: "focus", ids, target })} />}
    </div>
    <div className="lesson-model-settings-controls">{controls}</div>
  </>;
}
