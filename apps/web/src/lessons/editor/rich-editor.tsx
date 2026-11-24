import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Jodit } from "jodit";
import type { ButtonsGroups, IJodit, IUIButton } from "jodit/types/types";
import { FileSelectorWidget } from "jodit/esm/modules/widget/index.js";
import "jodit/esm/plugins/all.js";
import "./jodit.css";
import "jodit/es2021/jodit.min.css";
import type { LessonText } from "../shared/contract";
import type { Language } from "../../i18n";
import { useLanguage } from "../../i18n";
import { editorHtml, lessonImageAlignment, resolveLessonImages, sanitizeLessonHtml } from "../shared/rich-text";
import { useLessonImages } from "../shared/image-context";
import type { LessonImageStage } from "../shared/archive";
import { lessonCellColorControl, lessonColorControl } from "./jodit-colors";
import { setupLessonToolbars } from "./jodit-toolbar";
import joditVietnamese from "./jodit-vi.json";

Jodit.lang.vi = joditVietnamese;

const blockFormats: Record<string, string> = {
  p: "Paragraph",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  blockquote: "Quote",
  pre: "Code block",
};

const primaryToolbarButtons = [
  "find", "|", "undo", "redo", "spellcheck", "copyformat", "|",
  "paragraph", "|", "bold", "italic", "underline", "lessonTextColor", "lessonBackgroundColor", "|",
  "link", "lessonImage", "table", "|", "align", "lineHeight", "ul", "ol", "outdent", "indent", "|",
  "eraser", "lessonMoreTools",
];

const extraToolGroups = [
  {
    label: "lessons.editorTools.format",
    buttons: ["strikethrough", "superscript", "subscript"],
  },
  {
    label: "lessons.editorTools.insert",
    buttons: ["video", "file", "symbols", "hr", "anchor"],
  },
] as const;

export default function RichEditor({ value, language, label, onChange }: {
  value: LessonText; language: Language; label: string; onChange: (value: LessonText) => void;
}) {
  const { t, language: interfaceLanguage } = useLanguage();
  const images = useLessonImages();
  const target = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageStage, setImageStage] = useState<LessonImageStage>();
  const [mode, setMode] = useState(document.documentElement.dataset.theme);
  const content = useEffectEvent(() => editorHtml(value, language, images.urls));
  const change = useEffectEvent((html: string) => {
    const clean = sanitizeLessonHtml(html, images.urls, images.paths);
    if (value.html?.includes(language) && clean === value[language]) return;
    onChange({ ...value, [language]: clean, html: [...new Set([...(value.html ?? []), language])] });
  });
  const addImage = useEffectEvent((blob: Blob, onProgress: (stage: LessonImageStage) => void) => images.add(blob, onProgress));
  const safeContent = useEffectEvent((html: string) => resolveLessonImages(sanitizeLessonHtml(html, images.urls, images.paths), images.urls));

  useEffect(() => {
    const observer = new MutationObserver(() => setMode(document.documentElement.dataset.theme));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const input = picker.current!;
    const textarea = target.current!;
    let editor: Jodit | undefined;
    let disposeToolbars: (() => void) | undefined;
    let closeMoreTools: (() => void) | undefined;
    let overflowButtons: string[] = [];
    let selection: Range | undefined;
    let disposed = false;
    let uploading = false;
    setFailed(false);
    setImageFailed(false);
    setImageStage(undefined);
    const uploadImages = async (sources: { load: () => Blob | Promise<Blob>; alt: string }[], range?: Range, replace?: HTMLImageElement) => {
      const instance = editor;
      if (!sources.length || !instance || uploading) return;
      uploading = true;
      instance.e.fire("updateToolbar");
      setImageFailed(false);
      try {
        const uploaded: { url: string; alt: string }[] = [];
        for (const source of sources) {
          const url = await addImage(await source.load(), stage => { if (!disposed) setImageStage(stage); });
          if (disposed) return;
          uploaded.push({ url, alt: source.alt });
        }
        instance.s.focus();
        if (range && instance.editor.contains(range.commonAncestorContainer)) instance.s.selectRange(range);
        for (const { url, alt } of uploaded) {
          const existing = replace && instance.editor.contains(replace);
          const image = existing ? replace : instance.createInside.element("img");
          image.src = url;
          image.alt = alt;
          if (!existing) instance.s.insertImage(image, null, 240);
        }
        instance.synchronizeValues();
      } catch {
        if (!disposed) setImageFailed(true);
      } finally {
        uploading = false;
        if (!disposed) {
          setImageStage(undefined);
          instance.e.fire("updateToolbar");
        }
      }
    };
    const uploadFiles = (files: File[], range?: Range) =>
      uploadImages(files.map(file => ({ load: () => file, alt: file.name })), range);
    const insertImage = () => {
      const files = Array.from(input.files ?? []);
      input.value = "";
      const range = selection;
      selection = undefined;
      void uploadFiles(files, range);
    };
    const onDrop = (event: Event) => {
      if (!(event instanceof DragEvent)) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length || !editor) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      editor.s.insertCursorAtPoint(event.clientX, event.clientY);
      void uploadFiles(files, editor.s.range.cloneRange());
    };
    const imageUrlPopup = (instance: IJodit, current: Node | null, close: () => void) => {
      const image = current instanceof HTMLImageElement ? current : null;
      const range = instance.s.range.cloneRange();
      return FileSelectorWidget(instance as Parameters<typeof FileSelectorWidget>[0], {
        url: (address, alt) => {
          close();
          void uploadImages([{
            alt,
            load: async () => {
              const url = new URL(address);
              if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid image URL");
              const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
              if (!response.ok) throw new Error("Image download failed");
              return response.blob();
            },
          }], range, image ?? undefined);
        },
      }, image, close);
    };
    try {
      textarea.value = content();
      editor = Jodit.make(textarea, {
        theme: mode === "dark" ? "dark" : "default",
        language: interfaceLanguage,
        defaultTimeout: 0, spellcheck: true, toolbarAdaptive: false,
        showXPathInStatusbar: false, allowTabNavigation: true,
        hidePoweredByJodit: true, allowResizeY: false,
        disablePlugins: ["font", "classSpan", "source", "print"],
        toolbarInlineDisabledButtons: [
          "source", "font", "fontsize", "cut", "copy", "paste", "selectall", "fullsize", "preview", "about",
          "brush", ...primaryToolbarButtons.filter(button => button !== "|"),
          ...extraToolGroups.flatMap<string>(({ buttons }) => buttons),
        ],
        imageDefaultWidth: 240,
        buttons: primaryToolbarButtons,
        events: {
          beforeToolbarBuild(buttons: ButtonsGroups): ButtonsGroups {
            return buttons.map(button => button === "brushCell" ? "lessonCellBorderColor" : button);
          },
        },
        controls: {
          paragraph: {
            text: "Paragraph",
            tooltip: "Block format",
            list: blockFormats,
            template: (_instance: IJodit, _name: string, text: string) => text,
            update(_instance: IJodit, button: IUIButton) {
              const format = String(button.state.value);
              const headingLevel = /^h([56])$/.exec(format)?.[1];
              button.state.text = headingLevel
                ? `Heading ${headingLevel}`
                : blockFormats[format] ?? "Paragraph";
            },
          },
          lessonTextColor: { icon: "font", tooltip: "Text color", ...lessonColorControl("color") },
          lessonBackgroundColor: { icon: "brush", tooltip: "Background color", ...lessonColorControl("background-color") },
          lessonCellBorderColor: { icon: "th", tooltip: "Cell border color", ...lessonCellColorControl("border-color") },
          image: { popup: imageUrlPopup },
          lessonImage: {
            icon: "image", tooltip: "Insert Image",
            list: ["lessonImageFile", "lessonImageUrl"],
            isDisabled: () => uploading,
          },
          lessonImageFile: {
            text: "From device",
            isDisabled: () => uploading,
            exec(instance: IJodit) {
              instance.s.focus();
              selection = instance.s.range.cloneRange();
              input.click();
            },
          },
          lessonImageUrl: {
            text: "From URL",
            isDisabled: () => uploading,
            popup(instance: IJodit, current: Node | null, close: () => void) {
              return imageUrlPopup(instance, current, () => {
                close();
                instance.e.fire("closeAllPopups");
              });
            },
          },
          lessonMoreTools: {
            icon: "dots", tooltip: "More tools",
            list: [],
            popup(instance: IJodit, _current: Node | null, close: () => void) {
              closeMoreTools = close;
              const menu = new Jodit.modules.UIGroup(instance);
              menu.container.classList.add("lesson-editor-tools");
              const groups = [
                ...(overflowButtons.length ? [{ label: instance.i18n("Default tools"), buttons: overflowButtons }] : []),
                ...extraToolGroups.map(({ label, buttons }) => ({ label: t(label), buttons })),
              ];
              for (const { label, buttons } of groups) {
                const section = new Jodit.modules.UIGroup(instance);
                const heading = instance.c.div("lesson-editor-tools-label");
                heading.textContent = label;
                section.container.setAttribute("aria-label", label);
                section.container.append(heading);
                const tools = new Jodit.modules.ToolbarEditorCollection(instance);
                tools.buttonSize = instance.o.toolbarButtonSize;
                tools.build([...buttons]);
                section.append(tools);
                menu.append(section);
              }
              return menu;
            },
          },
        },
        cleanHTML: { denyTags: "script,object,embed" },
        alignClasses: { img: lessonImageAlignment },
        table: { selectionCellStyle: "background-image: var(--lesson-cell-selection);" },
        image: {
          editSrc: false, editLink: false, useImageEditor: false, editBorderRadius: false,
          editMargins: true, editClass: false, editStyle: false, editId: false,
        },
      });
      const instance = editor;
      instance.editor.classList.add("lesson-rich-content");
      instance.editor.id = "lesson-write-body";
      instance.editor.lang = language;
      instance.editor.setAttribute("role", "textbox");
      instance.editor.setAttribute("aria-multiline", "true");
      instance.editor.setAttribute("aria-label", label);
      disposeToolbars = setupLessonToolbars(instance, buttons => {
        overflowButtons = buttons;
        closeMoreTools?.();
      });
      instance.e.fire("updateToolbar");
      if (interfaceLanguage === "vi") {
        instance.e.on("afterTableOpenPopup", (popup: HTMLElement) => {
          const grid = popup.querySelector('[role="grid"]');
          if (!grid) return;
          grid.setAttribute("aria-label", instance.i18n("Table size"));
          grid.querySelectorAll('[role="gridcell"]').forEach(cell => {
            const [rows, columns] = cell.getAttribute("aria-label")?.split(" by ") ?? [];
            if (rows && columns) {
              cell.setAttribute("aria-label", instance.i18n("%d rows, %d columns", rows, columns));
            }
          });
        });
      }
      instance.e.on("beforeCommandFontname beforeCommandFontsize", () => false);
      instance.e.on("postProcessSetEditorValue", () => {
        instance.editor.querySelectorAll<HTMLElement>('[style*="font"]').forEach(element => {
          const family = element.style.removeProperty("font-family");
          const size = element.style.removeProperty("font-size");
          if ((family || size) && !element.style.length) element.removeAttribute("style");
        });
      });
      instance.e.on("change", (html: string) => change(html));
      instance.e.on("beforePaste", (event: ClipboardEvent) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return;
        void uploadFiles(files, instance.s.range.cloneRange());
        return false;
      });
      instance.e.on("beforePasteInsert", (html: string | Node) => typeof html === "string" ? safeContent(html) : undefined);
      instance.e.on("beforeSetValueToEditor", (html?: string) => html === undefined ? undefined : safeContent(html));
      instance.e.on("beforeInsertNode", (node: Node) => {
        if (!(node instanceof DocumentFragment || node instanceof HTMLAnchorElement)) return;
        const template = document.createElement("template");
        template.content.append(node.cloneNode(true));
        template.innerHTML = safeContent(template.innerHTML);
        if (node instanceof DocumentFragment) node.replaceChildren(template.content);
        else {
          const link = template.content.firstElementChild;
          for (const name of node.getAttributeNames()) node.removeAttribute(name);
          if (link?.tagName === "A") {
            for (const { name, value } of Array.from(link.attributes)) node.setAttribute(name, value);
            node.replaceChildren(...link.childNodes);
          } else node.replaceChildren();
        }
      });
      instance.editor.addEventListener("drop", onDrop, true);
      input.addEventListener("change", insertImage);
    } catch (error) {
      console.error("Lesson editor failed", error);
      setFailed(true);
    }
    return () => {
      disposed = true;
      disposeToolbars?.();
      input.removeEventListener("change", insertImage);
      editor?.editor.removeEventListener("drop", onDrop, true);
      editor?.destruct();
    };
  }, [mode, label, language, interfaceLanguage, t]);

  return <div className="lesson-rich-editor">
    <textarea ref={target} hidden />
    <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden />
    {failed && <p role="alert">{t("lessons.richEditorError")}</p>}
    {imageFailed && <p role="alert">{t("lessons.imageAddError")}</p>}
    {imageStage && <div className="lesson-image-progress" role="status"><progress aria-label={t(`lessons.image.${imageStage}`)} /><span>{t(`lessons.image.${imageStage}`)}</span></div>}
  </div>;
}
