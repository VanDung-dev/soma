import type { OpenStaxReference } from "./catalog/types";
import { useLanguage } from "../i18n";

export function OpenStaxReading({ reference, compact = false }: { reference?: OpenStaxReference; compact?: boolean }) {
  if (!reference) return null;
  return <a className="openstax-reading" href="https://openstax.org/details/books/anatomy-and-physiology-2e"
    target="_blank" rel="noopener noreferrer" title="Anatomy and Physiology 2e · OpenStax, Rice University · 2022">
    {compact ? "OpenStax" : <>OpenStax · <cite lang="en">Anatomy and Physiology 2e</cite> · 2022</>}
  </a>;
}

export function OpenStaxLink({ reference, compact = false }: { reference?: OpenStaxReference; compact?: boolean }) {
  const { language, t } = useLanguage();
  if (!reference) return null;
  return <a href={reference.url} target="_blank" rel="noopener noreferrer" title={reference.names[language]}>
    {compact ? "OpenStax" : reference.names[language]}<span className="sr-only">{compact && ` — ${reference.names[language]}`} — {t("openstax.newTab")}</span>
  </a>;
}
