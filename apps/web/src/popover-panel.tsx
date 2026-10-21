import { useEffect, useRef, type ReactNode } from "react";
import { LineIcon } from "./icons";

export function PopoverPanel({ id, className, contentClassName = "", title, closeLabel, autoOpen = false, onClose, children }: {
  id: string;
  className: string;
  contentClassName?: string;
  title: string;
  closeLabel: string;
  autoOpen?: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (autoOpen) panel.current!.showPopover();
  }, [autoOpen]);
  return <section ref={panel} id={id} className={`app-popover ${className}`} popover="auto" role="dialog"
    aria-labelledby={`${id}-title`} onToggle={event => { if (event.newState === "closed") onClose?.(); }}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); panel.current!.hidePopover();
      }
    }}>
    <header className="guide-heading"><h2 id={`${id}-title`}>{title}</h2>
      <button className="controls-info" autoFocus aria-label={closeLabel} popoverTarget={id} popoverTargetAction="hide">
        <LineIcon name="close-small" size={14} />
      </button>
    </header>
    <div className={`popover-content ${contentClassName}`}>{children}</div>
  </section>;
}
