import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLanguage } from "../../i18n";
import { AlertCard } from "../../pages/alert-card";

type Result = boolean | "save";
type Request = { message: string; action: string; saveAction?: string; cancelAction?: string; resolve: (result: Result) => void };
const ConfirmContext = createContext<(message: string, action: string, saveAction?: string, cancelAction?: string) => Promise<Result>>(() => Promise.resolve(false));

export function LessonConfirmProvider({ children }: { children: ReactNode }) {
  const { t, language } = useLanguage();
  const [request, setRequest] = useState<Request>();
  const pending = useRef<Request>(undefined);

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
    setRequest(undefined);
    current?.resolve(confirmed);
  }

  useEffect(() => () => { pending.current?.resolve(false); }, []);

  return <ConfirmContext.Provider value={confirm}>
    {children}
    {request && <AlertCard title={language === "vi" ? "Xác nhận" : "Confirm"} message={request.message}
      onCancel={() => finish(false)} actions={[
        { label: request.cancelAction ?? t("lessons.cancel"), onClick: () => finish(false) },
        { label: request.action, primary: !request.saveAction, onClick: () => finish(true) },
        ...(request.saveAction ? [{ label: request.saveAction, primary: true, onClick: () => finish("save") }] : []),
      ]} />}
  </ConfirmContext.Provider>;
}

export const useLessonConfirm = () => useContext(ConfirmContext);
