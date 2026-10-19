import { useEffect, useId, useRef } from "react";
import { useLanguage } from "./i18n";

export function ExplodeControls({ value, disabled, locked, onChange }: {
  value: number;
  disabled: boolean;
  locked: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const { t } = useLanguage();
  const dragging = useRef(false);
  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop); window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); window.removeEventListener("blur", stop);
    };
  }, []);
  return <fieldset className="explode-control" disabled={disabled}>
    <legend className="sr-only">{t("explode.legend")}</legend>
    <div className="explode-label"><span><label htmlFor={id}>{t("explode.level")}</label>
      {locked && <small>{t("explode.locked")}</small>}</span><output htmlFor={id}>{value}%</output></div>
    <input id={id} type="range" min="0" max="100" step="1" value={value} list={`${id}-stages`}
      aria-valuetext={`${value}%`}
      // Native range thumbs own their mouse capture, including Safari's shadow thumb.
      onPointerDown={() => { dragging.current = true; }} onKeyDown={() => { dragging.current = false; }}
      onChange={event => {
        const amount = event.currentTarget.valueAsNumber;
        const detent = dragging.current ? [30, 60, 100].find(mark => Math.abs(mark - amount) <= 2) : undefined;
        onChange(detent ?? amount);
      }} />
    <datalist id={`${id}-stages`}>
      <option value="30" /><option value="60" /><option value="100" />
    </datalist>
  </fieldset>;
}
