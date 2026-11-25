import DOMPurify from "dompurify";
import type { Lesson, LessonText } from "./contract";
import type { Language } from "../../i18n";
import { is_lesson_image_path, lesson_image_paths } from "../../content/content.js";

const lessonElements = "div span p br strong b em i u s strike del ins sub sup mark code pre h1 h2 h3 h4 h5 h6 ul ol li blockquote a table caption colgroup col thead tbody tfoot tr th td hr img figure figcaption iframe video audio source".split(" ");
export const lessonImageAlignment = { left: "lesson-image-left", right: "lesson-image-right", center: "lesson-image-center" };
export const lessonTextClasses = { "lesson-text-muted": "Muted text", "lesson-text-highlight": "Highlight" };
const alignments = Object.values(lessonImageAlignment);
const lessonStyles = new Set("color background-color font-style font-weight line-height text-align text-decoration-line text-indent vertical-align margin-left margin-right margin-inline-start margin-inline-end padding-left padding-right padding-inline-start padding-inline-end list-style-type border-width border-style border-color border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-top-color border-right-color border-bottom-color border-left-color border-collapse border-spacing border-radius".split(" "));

function secureMediaUrl(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

function isVideoEmbed(url: URL) {
  return ((url.origin === "https://www.youtube.com" || url.origin === "https://www.youtube-nocookie.com") && /^\/embed\/[\w-]+$/.test(url.pathname))
    || (url.origin === "https://player.vimeo.com" && /^\/video\/\d+(?:\/[\w-]+)?$/.test(url.pathname));
}

export function sanitizeLessonHtml(html: string, urls?: Map<string, string>, pathsByUrl?: Map<string, string>) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: lessonElements,
    ALLOWED_ATTR: ["href", "title", "target", "rel", "id", "start", "reversed", "value", "colspan", "rowspan", "span", "src", "alt", "width", "height", "data-lesson-image", "class", "style"],
    ADD_URI_SAFE_ATTR: ["src"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  template.content.querySelectorAll<HTMLElement>("[class], [style]").forEach(element => {
    const isImageLayout = element.matches("img, figure");
    const alignment = isImageLayout && alignments.find(name => element.classList.contains(name));
    const textClasses = element.matches("span, p, div") ? Object.keys(lessonTextClasses).filter(name => element.classList.contains(name)) : [];
    const supportsWidth = isImageLayout || element.matches("table, td, th, col, iframe, video");
    const width = supportsWidth && /^(\d+(?:\.\d+)?)(px|%)$/.exec(element.style.width);
    const hasCustomFont = element.style.fontFamily || element.style.fontSize;
    const styles = Array.from(element.style, name => [name, element.style.getPropertyValue(name)] as const)
      .filter(([name, value]) => lessonStyles.has(name) && !/\b(?:url|var|attr|env|image|expression)\s*\(/i.test(value));
    element.removeAttribute("class");
    element.removeAttribute("style");
    if (alignment) element.className = alignment;
    if (textClasses.length) element.classList.add(...textClasses);
    for (const [name, value] of styles) element.style.setProperty(name, value);
    if (width && Number(width[1]) > 0 && Number(width[1]) <= (width[2] === "%" ? 100 : 8192)) {
      element.style.width = width[0];
    }
    if (hasCustomFont && element.tagName === "SPAN" && !element.attributes.length) {
      element.replaceWith(...element.childNodes);
    }
  });
  template.content.querySelectorAll("[id]").forEach(element => {
    if (element.tagName !== "A" || !/^[\w-]{1,100}$/.test(element.id)) element.removeAttribute("id");
  });
  const paths = new Map(pathsByUrl ?? (urls ? [...urls].map(([path, url]) => [url, path]) : []));
  template.content.querySelectorAll("img").forEach(image => {
    const source = image.getAttribute("src") ?? "";
    const identity = image.getAttribute("data-lesson-image") ?? "";
    const path = paths.get(source) ?? (urls?.has(identity) ? identity : source);
    if (!is_lesson_image_path(path)) { image.remove(); return; }
    image.setAttribute("src", path);
    image.removeAttribute("data-lesson-image");
    for (const name of ["width", "height"]) {
      const value = image.getAttribute(name);
      const size = Number(value);
      if (name === "width" && value === "100%") {
        if (!image.style.width) image.style.width = value;
        image.removeAttribute(name);
      } else if (!Number.isInteger(size) || size < 1 || size > 8192) image.removeAttribute(name);
    }
  });
  template.content.querySelectorAll("iframe, video, audio, source").forEach(element => {
    const link = secureMediaUrl(element.getAttribute("src"));
    if (element.tagName === "IFRAME") {
      if (!link || !isVideoEmbed(link)) { element.remove(); return; }
      element.setAttribute("src", link.href);
      element.setAttribute("title", element.getAttribute("title") || "Video");
      element.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
      element.setAttribute("referrerpolicy", "strict-origin");
      element.setAttribute("loading", "lazy");
      element.setAttribute("allowfullscreen", "");
    } else if (element.tagName === "SOURCE") {
      if (!link || !element.parentElement?.matches("video, audio")) element.remove();
    } else {
      if (!link) element.removeAttribute("src");
      element.setAttribute("controls", "");
      element.setAttribute("preload", "none");
    }
  });
  template.content.querySelectorAll("video, audio").forEach(element => {
    if (!element.hasAttribute("src") && !element.querySelector("source[src]")) element.remove();
  });
  template.content.querySelectorAll("a").forEach(link => {
    if (link.getAttribute("href")?.startsWith("#")) {
      link.removeAttribute("target");
      link.removeAttribute("rel");
    } else {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
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

export function lessonHtml(value: LessonText, language: Language, urls?: Map<string, string>, fallback = true) {
  const resolvedLanguage = fallback && !value[language].trim() ? language === "vi" ? "en" : "vi" : language;
  return editorHtml(value, resolvedLanguage, urls);
}

export function lessonPlainText(value: LessonText, language: Language) {
  return plainLessonHtml(lessonHtml(value, language));
}

export function plainLessonHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img").forEach(image => image.replaceWith(document.createTextNode(image.alt)));
  template.content.querySelectorAll("br, div, p, li, h1, h2, h3, h4, h5, h6, tr").forEach(node => node.append(" "));
  return template.content.textContent?.trim() ?? "";
}

export function lessonImagePaths(lesson: Lesson) {
  return new Set<string>(lesson_image_paths(JSON.stringify(lesson)));
}
