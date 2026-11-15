import { useLanguage } from "../i18n";

export function ControlsGuide() {
  const { t } = useLanguage();
  return <div className="guide-sections">
    <section aria-label={t("controls.mouse.label")}><h3>{t("controls.mouse.label")}</h3>
      <dl>
        <div><dt>{t("controls.mouse.dragLeft")}</dt><dd>{t("controls.mouse.rotate")}</dd></div>
        <div><dt>{t("controls.mouse.holdRight")}</dt><dd>{t("context.hide")}</dd></div>
        <div><dt>{t("controls.mouse.holdLeft")}</dt><dd>{t("context.detach")}</dd></div>
        <div><dt>{t("controls.mouse.wheel")}</dt><dd>{t("controls.mouse.zoomAtCursor")}</dd></div>
        <div><dt>{t("controls.mouse.panGesture")}</dt><dd>{t("controls.mouse.pan")}</dd></div>
        <div><dt>{t("controls.mouse.selectGesture")}</dt><dd>{t("controls.mouse.selectGroup")}</dd></div>
        <div><dt>{t("controls.mouse.click")}</dt><dd>{t("controls.mouse.showInfo")}</dd></div>
      </dl>
    </section>
    <section className="guide-hand-camera" aria-label={t("handCamera.device.label")}>
      <h3>{t("handCamera.device.label")}</h3>
      <dl>
        <div><dt>{t("controls.hand.rightPinch")}</dt><dd>{t("controls.group.rotate")}</dd></div>
        <div><dt>{t("controls.hand.leftPinch")}</dt><dd>{t("controls.mouse.pan")}</dd></div>
        <div><dt>{t("controls.hand.bothPinch")}</dt><dd>{t("controls.hand.zoom")}</dd></div>
      </dl>
    </section>
  </div>;
}
