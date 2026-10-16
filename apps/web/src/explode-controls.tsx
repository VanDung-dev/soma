import { useId } from "react";

export function ExplodeControls({ value, disabled, onChange }: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return <fieldset className="explode-control" disabled={disabled}>
    <legend className="sr-only">Tách cấu trúc</legend>
    <div className="explode-label"><label htmlFor={id}>Mức độ tách</label><output htmlFor={id}>{value}%</output></div>
    <input id={id} type="range" min="0" max="100" step="1" value={value}
      aria-valuetext={`${value}%`} onChange={event => onChange(event.currentTarget.valueAsNumber)} />
    <div className="explode-endpoints"><span>Lắp ráp</span><span>Từng cấu trúc</span></div>
    <button type="button" className="explode-reset" onClick={() => onChange(0)}>Lắp lại</button>
  </fieldset>;
}
