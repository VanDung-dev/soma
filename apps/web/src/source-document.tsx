import { useEffect, useId, useState } from "react";
import { useLanguage } from "./i18n";
import { PopoverPanel } from "./popover-panel";

export function SourceDocument({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useLanguage();
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(path, { signal: abort.signal }).then(response => {
      if (!response.ok || response.headers.get("content-type")?.includes("text/html")) throw Error(`Document: ${response.status}`);
      return response.text();
    }).then(setText, () => { if (!abort.signal.aborted) setFailed(true); });
    return () => { abort.abort(); };
  }, [path]);
  return <PopoverPanel id={id} className="source-document" title={t("credit.link")} closeLabel={t("document.close")} autoOpen onClose={onClose}>
    {failed ? <p role="alert">{t("document.error")}</p>
      : text === null ? <p role="status">{t("document.loading")}</p> : <pre tabIndex={0}>{text}</pre>}
  </PopoverPanel>;
}
