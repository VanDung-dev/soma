import type { ReactNode } from "react";
import { useLanguage } from "../i18n";
import type { MessageKey } from "../i18n";

function MouseInput({ wheel = false, hold = false, right = false }: { wheel?: boolean; hold?: boolean; right?: boolean }) {
  const { t } = useLanguage();
  return <kbd className="onboarding-mouse" aria-label={t(wheel ? "controls.mouse.wheel" : hold ? right ? "controls.mouse.holdRight" : "controls.mouse.holdLeft" : right ? "controls.mouse.panGesture" : "controls.mouse.dragLeft")}>
    <svg viewBox="0 0 20 26" width="18" height="24" aria-hidden="true">
      <rect x="2" y="1" width="16" height="24" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {!wheel && <path d={right ? "M10 2c5 0 7 3 7 8v2h-7Z" : "M10 2C5 2 3 5 3 10v2h7Z"} fill="currentColor" opacity=".6" />}
      <path d="M10 2v10M3 12h14" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {wheel && <rect x="8" y="5" width="4" height="6" rx="2" fill="currentColor" />}
    </svg>{t(wheel ? "onboarding.input.scroll" : hold ? "onboarding.input.hold" : "onboarding.input.drag")}
  </kbd>;
}

export function OnboardingControls({ step, mouse }: { step: number; mouse: boolean }) {
  const { t } = useLanguage();
  const row = (label: MessageKey, input: ReactNode) => <li key={label}>
    <span className="onboarding-input">{input}</span><strong>{t(label)}</strong>
  </li>;
  let rows: ReactNode[];
  if (step === 3) rows = [row("search.label", <kbd aria-label={t("search.label")}>⌕</kbd>)];
  else if (!mouse) {
    if (step === 1) rows = [row("controls.mouse.rotate", <kbd>{t("onboarding.input.oneFinger")}</kbd>),
      row("onboarding.action.touchView", <kbd>{t("onboarding.input.twoFingers")}</kbd>)];
    else if (step === 2) rows = [row("onboarding.action.select", <kbd>{t("onboarding.input.tap")}</kbd>)];
    else if (step === 4) rows = [row("onboarding.action.visibility", <kbd>{t("onboarding.input.checkbox")}</kbd>),
      row("onboarding.action.select", <kbd>{t("onboarding.input.tap")}</kbd>)];
    else if (step === 5) rows = [row("onboarding.action.information", <kbd>{t("information.expand")}</kbd>)];
    else rows = [row("app.help", <kbd aria-label={t("app.help")}>ⓘ</kbd>)];
  } else if (step === 1) rows = [row("controls.mouse.rotate", <MouseInput />),
    row("onboarding.action.zoom", <MouseInput wheel />),
    row("onboarding.action.pan", <MouseInput right />),
    row("onboarding.action.reset", <kbd>R</kbd>)];
  else if (step === 2) rows = [row("context.detach", <><MouseInput hold /><span aria-hidden="true">→</span><kbd>{t("onboarding.input.drag")}</kbd></>),
    row("context.hide", <MouseInput hold right />),
    row("context.restore", <kbd>T</kbd>)];
  else if (step === 4) rows = [row("onboarding.action.visibility", <kbd>{t("onboarding.input.checkbox")}</kbd>),
    row("onboarding.action.select", <kbd>{t("onboarding.input.clickName")}</kbd>),
    row("onboarding.action.focus", <><kbd>Shift</kbd><span aria-hidden="true">+</span><kbd>Enter</kbd></>)];
  else if (step === 5) rows = [row("onboarding.action.information", <kbd>{t("information.expand")}</kbd>)];
  else rows = [row("app.help", <kbd>G</kbd>)];
  return <ul className="onboarding-shortcuts">{rows}</ul>;
}
