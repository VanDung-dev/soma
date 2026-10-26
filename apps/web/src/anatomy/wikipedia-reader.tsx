import { useEffect, useRef, useState } from "react";
import references from "../../../../content/wikipedia-references.json";
import { anatomyNames } from "./anatomy-names";
import { useLanguage } from "../i18n";
import { isTauri } from "@tauri-apps/api/core";

const articles: Record<string, { url: string; status: string }> = references.articles;

export function wikipediaReference(name: string) {
  const article = Object.hasOwn(articles, name) ? articles[name] : undefined;
  if (!article) return undefined;
  const url = new URL(article.url);
  if (url.protocol !== "https:" || url.host !== "en.wikipedia.org" || !url.pathname.startsWith("/wiki/") || url.search) return undefined;
  return article;
}

function readingUrl(value: unknown) {
  if (typeof value !== "string" || !URL.canParse(value)) return;
  const url = new URL(value);
  if (url.protocol !== "https:" || !/^[a-z][a-z0-9-]*\.wikipedia\.org$/.test(url.hostname)
    || url.username || url.password || url.port || !url.pathname.startsWith("/wiki/")
    || [...url.searchParams.keys()].some(key => !["useskin", "variant"].includes(key))) return;
  try { decodeURIComponent(url.pathname); decodeURIComponent(url.hash); } catch { return; }
  url.searchParams.delete("useskin");
  return url.href;
}

export function WikipediaReader({ name, expanded = false }: { name: string; expanded?: boolean }) {
  const { language, t } = useLanguage();
  const article = wikipediaReference(name);
  const label = anatomyNames(name)[language];
  const [reload, setReload] = useState(0);
  const [currentUrl, setReadingUrl] = useState(article?.url);
  const [loading, setLoading] = useState(!!article);
  const frame = useRef<HTMLIFrameElement>(null);
  const homePage = useRef<string | undefined>(undefined);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !["wikipedia:ready", "wikipedia:location", "wikipedia:loading"].includes(event.data?.type)) return;
      const url = readingUrl(event.data.url);
      if (!url) return;
      if (event.data.type === "wikipedia:loading") { setLoading(true); return; }
      if (event.data.type === "wikipedia:ready") { homePage.current ??= url.split("#")[0]; setLoading(false); }
      setReadingUrl(url);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  const resetSection = () => {
    if (!article || !currentUrl || currentUrl.split("#")[0] !== (homePage.current ?? article.url.split("#")[0])) return;
    const url = new URL(homePage.current ?? article.url); url.hash = new URL(article.url).hash;
    frame.current?.contentWindow?.postMessage({ type: "wikipedia:reset", url: url.href }, "*");
  };
  useEffect(resetSection, [expanded]);
  useEffect(() => {
    const panel = frame.current?.closest(".information-panel");
    const resized = (event: Event) => {
      if (event.target === panel && (event as TransitionEvent).propertyName === "width") resetSection();
    };
    panel?.addEventListener("transitionend", resized);
    return () => panel?.removeEventListener("transitionend", resized);
  }, [article?.url, currentUrl]);
  const search = `https://en.wikipedia.org/w/index.php?title=Special:Search&fulltext=1&search=${encodeURIComponent(name.replace(/^[1-9]:\s*/, ""))}`;
  const proxy = import.meta.env.VITE_WIKIPEDIA_PROXY_URL || "/wikipedia";
  return <section className="wikipedia-reader" aria-label={t("wikipedia.section.label", { name: label })}>
    {article ? <div className="wikipedia-frame">
      <iframe key={reload} className="wikipedia-article" ref={frame}
      src={`${proxy}?url=${encodeURIComponent(article.url)}${new URL(article.url).hash}`}
      title={t("wikipedia.frame.title", { name: label })} aria-busy={loading}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
      onLoad={() => {
        setLoading(false);
        if (isTauri() && import.meta.env.DEV) frame.current?.contentWindow?.postMessage({ type: "wikipedia:contextmenu", blocked: true }, "*");
      }} />
      {loading && <div className="wikipedia-skeleton" role="status">
        <span className="sr-only">{t("wikipedia.loading")}</span>
        <div className="wikipedia-skeleton-content" aria-hidden="true">
          <span className="skeleton-title" /><span /><span /><span className="skeleton-short" />
          <span className="skeleton-block" /><span /><span className="skeleton-short" />
        </div>
      </div>}
    </div>
      : <p>{t("wikipedia.notLinked")} <a href={search} target="_blank" rel="noreferrer">{t("wikipedia.search", { name })}</a></p>}
    <div className="reader-actions">
      {article && <>
        <button onClick={() => { homePage.current = undefined; setReadingUrl(article.url); setLoading(true); setReload(value => value + 1); }}>{t("wikipedia.returnToArticle")}</button>
        <a href={currentUrl} target="_blank" rel="noreferrer">{t("wikipedia.open")}</a>
      </>}
    </div>
    <details className="reference-mapping" onToggle={event => {
        if (event.currentTarget.open) event.currentTarget.scrollIntoView({ block: "nearest" });
      }}>
        <summary>{t("wikipedia.notes.summary")}</summary>
        <div className="reference-mapping-description">
          <p className="reference-notice">{t("wikipedia.notes.disclaimer")}</p>
        </div>
      </details>
  </section>;
}
