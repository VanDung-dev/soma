import { useEffect, useMemo, useState } from "react";
import type { Catalog } from "../../anatomy/catalog/types";
import { StructureSearch } from "../../anatomy/structure-search";
import { StructureTree } from "../../anatomy/structure-tree";
import { useLanguage } from "../../i18n";
import { fetchModelAsset } from "../../model-assets";
import { PopoverPanel } from "../../popover-panel";

export function LessonModelSetup({ catalog, modelId, modelIds, targetId, visibleIds, selectedPart, onModel, onModels, onChoose, onChangeScene, onSelectPart }: {
  catalog: Catalog;
  modelId: string;
  modelIds: string[];
  targetId: string;
  visibleIds: string[];
  selectedPart?: string;
  onModel: (id: string) => void;
  onModels?: (ids: string[]) => void;
  onChoose: (ids: string[], partId?: string) => void;
  onChangeScene: (ids: string[]) => void;
  onSelectPart: (id: string, target?: boolean) => void;
}) {
  const { language, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const shown = useMemo(() => new Set(visibleIds), [visibleIds]);
  const reveal = useMemo(() => ({ id: selectedPart || targetId }), [selectedPart, targetId]);

  function handleToggleSystem(rootId: string) {
    const next = modelIds.includes(rootId)
      ? modelIds.filter(id => id !== rootId)
      : [...modelIds, rootId];
    if (onModels) onModels(next);
    else onModel(next[0] ?? "");
  }

  function handleSelectAll() {
    const all = catalog.roots.map(r => r.id);
    if (onModels) onModels(all);
    else onModel(all[0] ?? "");
  }

  function handleDeselectAll() {
    if (onModels) onModels([]);
    else onModel("");
  }

  function handleSelectChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(event.target.selectedOptions, o => o.value).filter(Boolean);
    if (onModels) onModels(selected);
    else onModel(selected[0] ?? "");
  }
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setFailed(false);
    void Promise.all(catalog.roots.map(async root => {
      const response = await fetchModelAsset(root.model!.path.replace(/\.glb(?:\.br)?$/, ".json"), { signal: abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.text();
      if (!abort.signal.aborted) catalog.ingestMetadata(root, json);
    })).then(() => {
      if (!abort.signal.aborted) { catalog.finish(); setLoading(false); }
    }, error => {
      if (!abort.signal.aborted) { console.error("Lesson structure search failed", error); setFailed(true); setLoading(false); }
    });
    return () => abort.abort();
  }, [catalog, attempt]);

  return <div className="lesson-model-toolbar">
    <StructureSearch catalog={catalog} disabled={loading || failed} label={t("lessons.addSceneStructure")} compact
      onSelect={id => {
        const ids = catalog.target(id) ? catalog.members(id) : [id];
        onChoose(ids, catalog.target(id) ? undefined : id);
      }} />
    <button className="lesson-button" popoverTarget="lesson-model-settings">{t("lessons.modelSettings")}</button>
    <PopoverPanel id="lesson-model-settings" className="lesson-model-settings" title={t("lessons.modelSettings")} closeLabel={t("lessons.closeModelSettings")}>
      <div className="lesson-fields">
        <div className="lesson-model-systems">
          <div className="lesson-model-systems-header">
            <label htmlFor="lesson-model-select" className="lesson-field-label">{t("lessons.model")}</label>
            <div className="lesson-inspector-actions">
              <button
                type="button"
                className="lesson-button"
                disabled={loading || failed || catalog.roots.length === 0 || catalog.roots.every(r => modelIds.includes(r.id))}
                onClick={handleSelectAll}
              >
                {t("catalog.showAll")}
              </button>
              <button
                type="button"
                className="lesson-button"
                disabled={loading || failed || !modelIds.length}
                onClick={handleDeselectAll}
              >
                {t("catalog.hideAll")}
              </button>
            </div>
          </div>
          <div className="lesson-model-systems-list" role="group" aria-label={t("lessons.model")}>
            {catalog.roots.map(model => {
              const checked = modelIds.includes(model.id);
              return (
                <label key={model.id} className="lesson-system-checkbox">
                  <input
                    type="checkbox"
                    value={model.id}
                    checked={checked}
                    onChange={() => handleToggleSystem(model.id)}
                  />
                  <span className="lesson-system-name">{model.names[language]}</span>
                </label>
              );
            })}
            {modelIds.filter(id => !catalog.roots.some(m => m.id === id)).map(id => (
              <label key={id} className="lesson-system-checkbox">
                <input
                  type="checkbox"
                  value={id}
                  checked={true}
                  onChange={() => handleToggleSystem(id)}
                />
                <span className="lesson-system-name">{id}</span>
              </label>
            ))}
          </div>
          <select
            id="lesson-model-select"
            multiple
            className="lesson-model-select sr-only"
            value={modelIds}
            onChange={handleSelectChange}
          >
            {catalog.roots.map(model => (
              <option key={model.id} value={model.id}>
                {model.names[language]}
              </option>
            ))}
            {modelIds.filter(id => !catalog.roots.some(m => m.id === id)).map(id => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="catalog-tree lesson-scene-tree">
        <h3>{t("lessons.sceneStructures")}</h3>
        <div className="lesson-inspector-actions">
          <button className="lesson-button" disabled={loading || failed || !modelIds.length} onClick={() => onChangeScene([...new Set(modelIds.flatMap(id => catalog.members(id)))])}>{t("catalog.showAll")}</button>
          <button className="lesson-button" disabled={loading || failed || !visibleIds.length} onClick={() => onChangeScene([])}>{t("catalog.hideAll")}</button>
          <button className="lesson-button" disabled={loading || failed || !targetId} onClick={() => onChangeScene(catalog.members(targetId))}>{t("lessons.resetScene")}</button>
        </div>
        <p role="status">{t("lessons.sceneCount", { count: visibleIds.length })}</p>
        {!loading && !failed && (
          modelIds.length > 0 ? (
            <StructureTree catalog={catalog} rootIds={modelIds} visibleIds={shown} selected={selectedPart ?? ""}
              targetId={catalog.target(selectedPart ?? "") ? selectedPart : targetId} reveal={reveal} disabled={false} onVisibility={(members, visible) => {
                const next = new Set(visibleIds);
                members.forEach(id => { if (visible) next.add(id); else next.delete(id); });
                onChangeScene([...next]);
              }} onSelect={onSelectPart} onTarget={id => onSelectPart(id, true)}
              onFocus={(members, target) => onChangeScene(target ? catalog.members(target) : members)} />
          ) : (
            <p className="lesson-document-hint">{t("lessons.noModel")}</p>
          )
        )}
      </div>
    </PopoverPanel>
    {loading && <span className="lesson-model-search-status" role="status">{t("lessons.loadingStructures")}</span>}
    {failed && <div className="lesson-model-search-status" role="alert">{t("lessons.targetError")} <button className="lesson-save-retry" onClick={() => setAttempt(attempt + 1)}>{t("lessons.retry")}</button></div>}
  </div>;
}
