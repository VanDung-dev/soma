import { useEffect, useId, useState } from "react";
import { useLanguage } from "./i18n";
import { PopoverPanel } from "./popover-panel";
import { fetchModelAsset, usesBundledModels } from "./model-assets";

export function SourceDocument({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useLanguage();
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const options = { signal: abort.signal };
    const bundled = usesBundledModels && path.startsWith("/models/");
    const response = bundled
      ? fetchModelAsset(path.slice(1), options)
      : fetch(path, options);
    response.then(response => {
      if (!response.ok || (!bundled && response.headers.get("content-type")?.includes("text/html"))) {
        throw Error(`Document: ${response.status}`);
      }
      return response.text();
    }).then(setText, () => { if (!abort.signal.aborted) setFailed(true); });
    return () => { abort.abort(); };
  }, [path]);
  return <PopoverPanel id={id} className="source-document" title={t("credit.link")} closeLabel={t("document.close")} autoOpen onClose={onClose}>
    {failed ? <p role="alert">{t("document.error")}</p>
      : text === null ? <p role="status">{t("document.loading")}</p> : <pre tabIndex={0}>{text}</pre>}
  </PopoverPanel>;
}
