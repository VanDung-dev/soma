import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLanguage } from "../../i18n";

type Result = boolean | "save";
type Request = { message: string; action: string; saveAction?: string; cancelAction?: string; resolve: (result: Result) => void };
const ConfirmContext = createContext<(message: string, action: string, saveAction?: string, cancelAction?: string) => Promise<Result>>(() => Promise.resolve(false));

export function LessonConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [request, setRequest] = useState<Request>();
  const pending = useRef<Request>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);

  function confirm(message: string, action: string, saveAction?: string, cancelAction?: string) {
    if (pending.current) return Promise.resolve(false);
    return new Promise<Result>(resolve => {
      pending.current = { message, action, saveAction, cancelAction, resolve };
      setRequest(pending.current);
    });
  }

  function finish(confirmed: Result) {
    const current = pending.current;
    pending.current = undefined;
    dialog.current?.close();
    setRequest(undefined);
    current?.resolve(confirmed);
  }

  useEffect(() => {
    if (request && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
      dialog.current.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [request]);
  useEffect(() => () => { pending.current?.resolve(false); }, []);

  return <ConfirmContext.Provider value={confirm}>
    {children}
    <dialog ref={dialog} className="lesson-confirm-dialog" aria-labelledby="lesson-confirm-message"
      onCancel={event => { event.preventDefault(); finish(false); }}>
      <p id="lesson-confirm-message">{request?.message}</p>
      <div className="lesson-confirm-actions">
        <button type="button" className="lesson-button" autoFocus onClick={() => finish(false)}>{request?.cancelAction ?? t("lessons.cancel")}</button>
        <button type="button" className="lesson-button lesson-danger" onClick={() => finish(true)}>{request?.action}</button>
        {request?.saveAction && <button type="button" className="lesson-button lesson-primary" onClick={() => finish("save")}>{request.saveAction}</button>}
      </div>
    </dialog>
  </ConfirmContext.Provider>;
}

export const useLessonConfirm = () => useContext(ConfirmContext);
