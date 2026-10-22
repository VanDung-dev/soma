import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { useLanguage } from "../i18n";
import { PopoverPanel } from "../popover-panel";
import { placeOnboarding, spotlightPath } from "./onboarding-layout";
import { OnboardingControls } from "./onboarding-controls";

export const onboardingStorageKey = "anatomy-onboarding:v1";

export function readOnboardingStatus(): "completed" | "dismissed" | null {
  try {
    const value = window.localStorage.getItem(onboardingStorageKey);
    return value === "completed" || value === "dismissed" ? value : null;
  } catch { return null; }
}

const steps = ["welcome", "camera", "detach", "search", "tree", "information", "help"] as const;
const targets = ["", ".model-focus-frame", ".model-focus-frame", ".tree-actions", ".catalog-tree", ".information-panel", ".app-menu-actions > button:first-child"];

export function AnatomyOnboarding({ replay, onPanelChange }: {
  replay: boolean;
  onPanelChange: (panel: "catalog" | "information" | null) => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  const [step, setStep] = useState<number | null>(() => replay || !readOnboardingStatus() ? 0 : null);
  const [mouse, setMouse] = useState(() => window.matchMedia("(any-pointer: fine)").matches);
  const finished = useRef(false);
  const spotlight = useRef<HTMLDivElement>(null);
  const finish = (status: "completed" | "dismissed") => {
    if (finished.current) return;
    finished.current = true;
    try { window.localStorage.setItem(onboardingStorageKey, status); } catch {}
    setStep(null);
    onPanelChange(null);
    document.getElementById(id)?.closest(".study-shell")?.querySelector<HTMLCanvasElement>("canvas")?.focus({ preventScroll: true });
  };
  const dismiss = useEffectEvent(() => finish("dismissed"));

  useLayoutEffect(() => {
    if (step !== null) spotlight.current!.showPopover();
  }, [step]);
  useEffect(() => {
    const media = window.matchMedia("(any-pointer: fine)");
    const change = () => setMouse(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (step === null) return;
    const card = document.getElementById(id)!;
    const shell = card.closest<HTMLElement>(".study-shell")!;
    const workspace = shell.querySelector<HTMLElement>("#workspace")!;
    shell.dataset.onboarding = String(step);
    onPanelChange(step === 3 || step === 4 ? "catalog" : step === 5 ? "information" : null);
    const target = targets[step] ? shell.querySelector<HTMLElement>(targets[step]!) : null;
    const layer = spotlight.current!;
    const dimmer = layer.querySelector<HTMLElement>(".onboarding-dimmer")!;
    const focus = layer.querySelector<HTMLElement>(".onboarding-focus")!;
    let frame = 0;
    const resize = () => {
      frame = 0;
      const bounds = workspace.getBoundingClientRect();
      Object.assign(dimmer.style, { inset: "auto", left: `${bounds.left}px`, top: `${bounds.top}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`, borderRadius: getComputedStyle(workspace).borderRadius });
      for (const [name, value] of Object.entries({ width: bounds.width, space: bounds.height, height: card.getBoundingClientRect().height })) {
        shell.style.setProperty(`--onboarding-${name}`, `${value}px`);
      }
      const visibleTarget = target?.getClientRects().length ? target
        : step === 3 || step === 4 ? shell.querySelector<HTMLElement>(".anatomy-panel-toggles button")
          : step === 5 ? shell.querySelector<HTMLElement>(".anatomy-panel-toggles button:nth-child(2)") : null;
      const rect = visibleTarget?.getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(shell).getPropertyValue("--panel-inset"));
      const horizontalPadding = step === 3 ? 5 : 0;
      const placementTarget = rect ? { left: rect.left - horizontalPadding, top: rect.top,
        right: rect.right + horizontalPadding, bottom: rect.bottom, width: rect.width + horizontalPadding * 2, height: rect.height } : null;
      const position = placeOnboarding(bounds, placementTarget, card.getBoundingClientRect(), inset, step === 6 ? "below" : undefined);
      Object.assign(card.style, { left: `${position.left}px`, top: `${position.top}px` });
      card.dataset.placement = position.placement;
      card.dataset.positioned = "true";
      focus.hidden = !rect;
      if (!rect) { dimmer.style.clipPath = "none"; return; }
      const bottom = position.placement === "bottom" ? Math.min(rect.bottom, position.top - 12) : rect.bottom;
      const hole = { left: Math.max(bounds.left, rect.left - horizontalPadding), top: Math.max(bounds.top, rect.top),
        right: Math.min(bounds.right, rect.right + horizontalPadding), bottom: Math.max(rect.top + 1, Math.min(bounds.bottom, bottom)),
        radius: parseFloat(getComputedStyle(visibleTarget!).borderTopLeftRadius) || 0 };
      const localHole = { ...hole, left: hole.left - bounds.left, top: hole.top - bounds.top,
        right: hole.right - bounds.left, bottom: hole.bottom - bounds.top };
      dimmer.style.clipPath = `path(evenodd, "${spotlightPath(bounds.width, bounds.height, localHole)}")`;
      Object.assign(focus.style, { left: `${hole.left}px`, top: `${hole.top}px`, width: `${hole.right - hole.left}px`,
        height: `${hole.bottom - hole.top}px`, borderRadius: `${hole.radius}px` });
      const horizontal = position.placement === "right" || position.placement === "left";
      const arrow = horizontal ? (hole.top + hole.bottom) / 2 - position.top : (hole.left + hole.right) / 2 - position.left;
      const size = horizontal ? card.offsetHeight : card.offsetWidth;
      const arrowInset = parseFloat(getComputedStyle(card).borderTopLeftRadius) + 12;
      card.style.setProperty("--onboarding-arrow", `${Math.max(arrowInset, Math.min(arrow, size - arrowInset))}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(resize); };
    resize();
    const heading = card.querySelector("h2")!;
    heading.tabIndex = -1; heading.focus({ preventScroll: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(shell); observer.observe(workspace); observer.observe(card);
    if (target) observer.observe(target);
    for (const panel of shell.querySelectorAll(".catalog-panel, .anatomy-panel-toggles")) observer.observe(panel);
    window.addEventListener("resize", schedule);
    shell.addEventListener("scroll", schedule, true);
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[popover="auto"]:popover-open')) return;
      event.preventDefault(); event.stopPropagation();
      dismiss();
    };
    document.addEventListener("keydown", keyDown, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      shell.removeEventListener("scroll", schedule, true);
      document.removeEventListener("keydown", keyDown, true);
      delete shell.dataset.onboarding;
      for (const name of ["width", "space", "height"]) shell.style.removeProperty(`--onboarding-${name}`);
    };
  }, [id, step, onPanelChange]);

  if (step === null) return null;
  const name = steps[step]!;
  return <>
    <div ref={spotlight} className="onboarding-spotlight" popover="manual" aria-hidden="true">
      <div className="onboarding-dimmer" /><div className="onboarding-focus" hidden />
    </div>
    <PopoverPanel id={id} className="anatomy-onboarding" contentClassName="onboarding-content"
    title={t(step === 0 ? "onboarding.title" : `onboarding.${name}.title`)} closeLabel={t("onboarding.skip")} popover="manual" autoOpen onClose={() => finish("dismissed")}>
    <div className="onboarding-copy" aria-live="polite" aria-atomic="true">
      {step > 0 && <p className="onboarding-progress">{t("onboarding.progress", { step, total: steps.length - 1 })}</p>}
      {step === 0 && <h3>{t("onboarding.welcome.title")}</h3>}
      {step === 0 ? <p>{t("onboarding.welcome.body")}</p> : <>
        <OnboardingControls step={step} mouse={mouse} />
        {!mouse && step === 2 && <p className="onboarding-note">{t("onboarding.detach.limit")}</p>}
      </>}
    </div>
    <div className="onboarding-actions">
      <button className="onboarding-skip" onClick={() => finish("dismissed")}>{t("onboarding.skip")}</button>
      <div className="onboarding-navigation">
        {step > 0 && <button className="onboarding-back" onClick={() => setStep(step - 1)}>{t("onboarding.back")}</button>}
        <button className="onboarding-next" onClick={() => step === steps.length - 1 ? finish("completed") : setStep(step + 1)}>
          {t(step === 0 ? "onboarding.start" : step === steps.length - 1 ? "onboarding.finish" : "onboarding.next")}
        </button>
      </div>
    </div>
    </PopoverPanel>
  </>;
}
