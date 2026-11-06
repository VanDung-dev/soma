import DOMPurify from "dompurify";
import type { LessonText } from "./contract";
import type { Language } from "../i18n";

export const lessonElements = "p,br,strong,b,em,i,u,s,h2,h3,h4,ul,ol,li,blockquote,a[href|title|target|rel],table,thead,tbody,tr,th[colspan|rowspan],td[colspan|rowspan],hr";

export function sanitizeLessonHtml(html: string) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: lessonElements.split(",").map(tag => tag.split("[")[0]!),
    ALLOWED_ATTR: ["href", "title", "target", "rel", "colspan", "rowspan"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  template.content.querySelectorAll("a").forEach(link => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  return template.innerHTML;
}

export function editorHtml(value: LessonText, language: Language) {
  if (value.html?.includes(language)) return sanitizeLessonHtml(value[language]);
  const text = document.createElement("div");
  text.textContent = value[language];
  return text.innerHTML.replace(/\r?\n/g, "<br>");
}

export function lessonHtml(value: LessonText, language: Language) {
  return editorHtml(value, value[language].trim() ? language : language === "vi" ? "en" : "vi");
}

export function lessonPlainText(value: LessonText, language: Language) {
  const template = document.createElement("template");
  template.innerHTML = lessonHtml(value, language);
  template.content.querySelectorAll("br, p, li, h2, h3, h4, tr").forEach(node => node.append(" "));
  return template.content.textContent?.trim() ?? "";
}
