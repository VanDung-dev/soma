import DOMPurify from "dompurify";
import type { Lesson, LessonText } from "./contract";
import type { Language } from "../../i18n";
import { is_lesson_image_path, lesson_image_paths } from "../../content/content.js";

export const lessonElements = "p,br,strong,b,em,i,u,s,h2,h3,h4,ul,ol,li,blockquote,a[href|title|target|rel],table,thead,tbody,tr,th[colspan|rowspan],td[colspan|rowspan],hr,img[src|alt|title|width|height|data-lesson-image]";

export function sanitizeLessonHtml(html: string, urls?: Map<string, string>, pathsByUrl?: Map<string, string>) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: lessonElements.split(",").map(tag => tag.split("[")[0]!),
    ALLOWED_ATTR: ["href", "title", "target", "rel", "colspan", "rowspan", "src", "alt", "width", "height", "data-lesson-image"],
    ADD_URI_SAFE_ATTR: ["src"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  const paths = new Map(pathsByUrl ?? (urls ? [...urls].map(([path, url]) => [url, path]) : []));
  template.content.querySelectorAll("img").forEach(image => {
    const source = image.getAttribute("src") ?? "";
    const identity = image.getAttribute("data-lesson-image") ?? "";
    const path = paths.get(source) ?? (urls?.has(identity) ? identity : source);
    if (!is_lesson_image_path(path)) { image.remove(); return; }
    image.setAttribute("src", path);
    image.removeAttribute("data-lesson-image");
    for (const name of ["width", "height"]) {
      const size = Number(image.getAttribute(name));
      if (!Number.isInteger(size) || size < 1 || size > 8192) image.removeAttribute(name);
    }
  });
  template.content.querySelectorAll("a").forEach(link => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  return template.innerHTML;
}

export function resolveLessonImages(html: string, urls: Map<string, string>) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img").forEach(image => {
    const path = image.getAttribute("src") ?? "";
    const url = urls.get(path);
    if (url) { image.setAttribute("src", url); image.setAttribute("data-lesson-image", path); }
    else image.replaceWith(document.createTextNode(image.alt));
  });
  return template.innerHTML;
}

export function editorHtml(value: LessonText, language: Language, urls?: Map<string, string>) {
  if (value.html?.includes(language)) {
    const html = sanitizeLessonHtml(value[language]);
    return urls ? resolveLessonImages(html, urls) : html;
  }
  const text = document.createElement("div");
  text.textContent = value[language];
  return text.innerHTML.replace(/\r?\n/g, "<br>");
}

export function lessonHtml(value: LessonText, language: Language, urls?: Map<string, string>) {
  return editorHtml(value, value[language].trim() ? language : language === "vi" ? "en" : "vi", urls);
}

export function lessonPlainText(value: LessonText, language: Language) {
  const template = document.createElement("template");
  template.innerHTML = lessonHtml(value, language);
  template.content.querySelectorAll("img").forEach(image => image.replaceWith(document.createTextNode(image.alt)));
  template.content.querySelectorAll("br, p, li, h2, h3, h4, tr").forEach(node => node.append(" "));
  return template.content.textContent?.trim() ?? "";
}

export function lessonImagePaths(lesson: Lesson) {
  return new Set<string>(lesson_image_paths(JSON.stringify(lesson)));
}
