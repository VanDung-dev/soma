import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCatalog } from "../anatomy/core";
import type { Catalog } from "../anatomy/catalog/types";
import { OrientationAxes } from "../anatomy/orientation-axes";
import { ViewerStatusNotice } from "../anatomy/viewer-status";
import { useLanguage } from "../i18n";
import { useLessonViewer } from "./viewer";

export function EditorScene({ modelId, targetId, frame, inactive }: {
  modelId: string; targetId: string; frame: HTMLElement; inactive: boolean;
}) {
  const { t } = useLanguage();
  const [catalog, setCatalog] = useState<Catalog>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let owned: Catalog | undefined;
    getCatalog().then(value => {
      if (!active) { value.free(); return; }
      owned = value;
      setCatalog(value);
    }, error => {
      if (active) { console.error("Lesson scene catalog failed", error); setFailed(true); }
    });
    return () => { active = false; owned?.free(); };
  }, []);

  if (catalog) return <Scene catalog={catalog} modelId={modelId} targetId={targetId} frame={frame} inactive={inactive} />;
  return createPortal(
    <p className={`lesson-model-message model-status${failed ? " model-error" : ""}`} role={failed ? "alert" : "status"}>
      {t(failed ? "lessons.targetError" : "viewer.status.loading")}
    </p>, frame);
}

function Scene({ catalog, modelId, targetId, frame, inactive }: {
  catalog: Catalog; modelId: string; targetId: string; frame: HTMLElement; inactive: boolean;
}) {
  const { t } = useLanguage();
  const { host, orientation, showAxes, session, state } = useLessonViewer(catalog, modelId, undefined, frame);
  const ready = !state.building && !state.error;
  useEffect(() => {
    if (ready) session.focus([], targetId);
  }, [ready, session, targetId]);

  return <div className="lesson-editor-scene" inert={inactive} aria-label={t("viewer.section.label")} role="group">
    <div className="model-canvas" ref={host} aria-busy={state.building && !state.error} />
    {createPortal(<>
      {showAxes && <div className="model-orientation"><OrientationAxes ref={orientation} disabled={!ready} onControl={session.control} /></div>}
      {!ready && <ViewerStatusNotice className="lesson-model-message" state={state} totalSystems={1} />}
      <button className="lesson-button lesson-scene-fit" disabled={!ready}
        onClick={() => session.focus([], targetId)}>{t("lessons.fitScene")}</button>
      <a className="lesson-model-credit" href="/models/z-anatomy/ATTRIBUTION.md" target="_blank" rel="noreferrer"
        aria-label={t("credit.link")}>Z-Anatomy</a>
    </>, frame)}
  </div>;
}
