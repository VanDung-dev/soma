import terminology from "../../../content/anatomy-terminology.json";
import type { Structure } from "./catalog/types";
import type { StudyTarget } from "./catalog/types";

export type AnatomyLanguage = "vi" | "en";
const terms: Record<string, { vi: string; en: string }> = terminology.terms;

export function anatomyNames(source: string) {
  return Object.hasOwn(terms, source) ? terms[source]! : { vi: source, en: source };
}

export function structureName(part: Structure, language: AnatomyLanguage = "vi") {
  const side = part.laterality === "left" ? (language === "vi" ? "trái" : "left")
    : part.laterality === "right" ? (language === "vi" ? "phải" : "right") : "";
  return anatomyNames(part.source_name)[language] + (side ? ` · ${side}` : "");
}

export function targetName(target: StudyTarget, language: AnatomyLanguage = "vi") {
  const names = anatomyNames(target.source_name);
  return language === "vi" && target.title !== target.source_name ? target.title : names[language];
}
