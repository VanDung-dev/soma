import { useEffect, useMemo, useState } from "react";
import type { Catalog } from "../anatomy/catalog/types";
import { StructureSearch } from "../anatomy/structure-search";
import { StructureTree } from "../anatomy/structure-tree";
import { useLanguage } from "../i18n";
import { fetchModelAsset } from "../model-assets";
import { PopoverPanel } from "../popover-panel";

export function LessonModelSetup({ catalog, modelId, modelIds, targetId, visibleIds, selectedPart, onModel, onChoose, onChangeScene, onSelectPart }: {
  catalog: Catalog;
  modelId: string;
  modelIds: string[];
  targetId: string;
  visibleIds: string[];
  selectedPart?: string;
  onModel: (id: string) => void;
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
        <label>{t("lessons.model")}
          <select value={modelId} onChange={event => onModel(event.target.value)}>
            <option value="">{t("lessons.noModel")}</option>
            {catalog.roots.map(model => <option key={model.id} value={model.id}>{model.names[language]}</option>)}
            {modelId && !catalog.roots.some(model => model.id === modelId) && <option value={modelId}>{modelId}</option>}
          </select>
        </label>
        <p>{t("lessons.sharedModel")}</p>
      </div>
      <div className="catalog-tree lesson-scene-tree">
        <h3>{t("lessons.sceneStructures")}</h3>
        <p>{t("lessons.composeSceneHint")}</p>
        <div className="lesson-inspector-actions">
          <button className="lesson-button" disabled={loading || failed} onClick={() => onChangeScene([...new Set((modelIds.length ? modelIds : catalog.roots.map(root => root.id)).flatMap(id => catalog.members(id)))])}>{t("catalog.showAll")}</button>
          <button className="lesson-button" disabled={loading || failed || !visibleIds.length} onClick={() => onChangeScene([])}>{t("catalog.hideAll")}</button>
          <button className="lesson-button" disabled={loading || failed || !targetId} onClick={() => onChangeScene(catalog.members(targetId))}>{t("lessons.resetScene")}</button>
        </div>
        <p role="status">{t("lessons.sceneCount", { count: visibleIds.length })}</p>
        {!loading && !failed && <StructureTree catalog={catalog} visibleIds={shown} selected={selectedPart ?? ""}
          targetId={catalog.target(selectedPart ?? "") ? selectedPart : targetId} reveal={reveal} disabled={false} onVisibility={(members, visible) => {
            const next = new Set(visibleIds);
            members.forEach(id => { if (visible) next.add(id); else next.delete(id); });
            onChangeScene([...next]);
          }} onSelect={onSelectPart} onTarget={id => onSelectPart(id, true)}
          onFocus={(members, target) => onChangeScene(target ? catalog.members(target) : members)} />}
      </div>
    </PopoverPanel>
    {loading && <span className="lesson-model-search-status" role="status">{t("lessons.loadingStructures")}</span>}
    {failed && <div className="lesson-model-search-status" role="alert">{t("lessons.targetError")} <button className="lesson-save-retry" onClick={() => setAttempt(attempt + 1)}>{t("lessons.retry")}</button></div>}
  </div>;
}
