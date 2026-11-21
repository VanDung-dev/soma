import { useEffect, useId, useRef } from "react";
import { LineIcon } from "../icons";

type AlertAction = { label: string; onClick: () => void; primary?: boolean; disabled?: boolean };

export function AlertCard({ title, message, actions, onCancel }: {
  title: string;
  message: string;
  actions: AlertAction[];
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return <dialog ref={dialog} className="alert-card-dialog lesson-confirm-dialog" aria-labelledby={titleId} aria-describedby={messageId}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <section className="hand-camera hand-camera-error" role="alert">
      <span className="hand-camera-error-symbol"><LineIcon name="alert-circle" size={24} /></span>
      <div className="hand-camera-error-message">
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{message}</p>
      </div>
      <div className="alert-card-actions lesson-confirm-actions">
        {actions.map((action, index) => <button key={index} type="button"
          className={action.primary ? "alert-card-button alert-card-primary hand-camera-error-retry" : "alert-card-button"}
          disabled={action.disabled} autoFocus={index === 0} onClick={action.onClick}>{action.label}</button>)}
      </div>
    </section>
  </dialog>;
}
