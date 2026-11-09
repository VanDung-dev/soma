import { useEffect, useEffectEvent, useRef, useState } from "react";
import tinymce from "tinymce";
import "tinymce/icons/default";
import "tinymce/themes/silver";
import "tinymce/models/dom";
import "tinymce/plugins/lists";
import "tinymce/plugins/link";
import "tinymce/plugins/table";
import "tinymce/plugins/image";
import "tinymce/skins/ui/oxide/skin.js";
import "tinymce/skins/ui/oxide/content.js";
import "tinymce/skins/ui/oxide-dark/skin.js";
import "tinymce/skins/ui/oxide-dark/content.js";
import type { Editor } from "tinymce";
import type { LessonText } from "../shared/contract";
import type { Language } from "../../i18n";
import { useLanguage } from "../../i18n";
import { editorHtml, lessonElements, resolveLessonImages, sanitizeLessonHtml } from "../shared/rich-text";
import { useLessonImages } from "../shared/image-context";
import type { LessonImageStage } from "../shared/archive";

export default function RichEditor({ value, language, label, onChange }: {
  value: LessonText; language: Language; label: string; onChange: (value: LessonText) => void;
}) {
  const { t } = useLanguage();
  const images = useLessonImages();
  const target = useRef<HTMLTextAreaElement>(null);
  const [failed, setFailed] = useState(false);
  const [imageStage, setImageStage] = useState<LessonImageStage>();
  const [mode, setMode] = useState(document.documentElement.dataset.theme);
  const content = useEffectEvent(() => editorHtml(value, language, images.urls));
  const change = useEffectEvent((html: string) => onChange({ ...value, [language]: sanitizeLessonHtml(html, images.urls),
    html: [...new Set([...(value.html ?? []), language])] }));
  const addImage = useEffectEvent((blob: Blob, onProgress: (stage: LessonImageStage) => void) => images.add(blob, onProgress));
  const safeContent = useEffectEvent((html: string) => resolveLessonImages(sanitizeLessonHtml(html, images.urls), images.urls));
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(document.documentElement.dataset.theme));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    let instance: Editor | undefined;
    let dialog: { block: (message: string) => void; unblock: () => void } | undefined;
    setFailed(false);
    setImageStage(undefined);
    const palette = getComputedStyle(document.documentElement);
    void tinymce.init({
      target: target.current!, license_key: "gpl", skin: mode === "dark" ? "oxide-dark" : "oxide",
      content_css: false, promotion: false, menubar: false, height: 300, min_height: 220,
      plugins: "lists link table image", toolbar: "undo redo | image | bold italic underline | blocks | bullist numlist | link table | removeformat",
      toolbar_mode: "sliding", block_formats: "Paragraph=p;Heading 2=h2;Heading 3=h3;Heading 4=h4",
      valid_elements: lessonElements, entity_encoding: "raw", paste_data_images: false,
      convert_urls: false, automatic_uploads: false, image_uploadtab: false, file_picker_types: "image",
      images_file_types: "jpg,jpeg,png,webp",
      file_picker_callback(callback) {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/png,image/jpeg,image/webp";
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          instance?.setProgressState(true);
          setImageStage("preparing");
          const currentDialog = dialog;
          currentDialog?.block(t("lessons.image.preparing"));
          void addImage(file, stage => {
            if (!disposed) { setImageStage(stage); if (dialog === currentDialog) currentDialog?.block(t(`lessons.image.${stage}`)); }
          }).then(url => { if (!disposed && dialog === currentDialog) callback(url, { alt: file.name }); }, error => {
            if (!disposed) instance?.notificationManager.open({ text: `${t("lessons.imageAddError")} ${String(error)}`, type: "error" });
          }).finally(() => {
            if (!disposed) { instance?.setProgressState(false); setImageStage(undefined); if (dialog === currentDialog) currentDialog?.unblock(); }
          });
        };
        input.click();
      },
      browser_spellcheck: true, content_language: language, iframe_aria_text: label,
      content_style: `body{font:14px/1.6 system-ui;margin:12px;color:${palette.getPropertyValue("--text")};background:${palette.getPropertyValue("--surface")}}p{margin:0 0 12px}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:6px}a{color:${palette.getPropertyValue("--accent")}}`,
      setup(editor) {
        instance = editor;
        editor.on("OpenWindow", event => { dialog = event.dialog; });
        editor.on("CloseWindow", event => { if (dialog === event.dialog) dialog = undefined; });
        editor.on("BeforeSetContent", event => { event.content = safeContent(event.content); });
        editor.on("init", () => {
          if (disposed) { editor.remove(); return; }
          editor.setContent(content());
          editor.undoManager.clear();
          editor.on("input change undo redo", () => { if (!disposed) change(editor.getContent()); });
        });
      },
    }).then(editors => { if (disposed) editors.forEach(editor => editor.remove()); }, error => {
      if (!disposed) { console.error("Lesson editor failed", error); setFailed(true); }
    });
    return () => { disposed = true; instance?.remove(); };
  }, [mode, label, language]);
  return <div className="lesson-rich-editor">
    <label className="lesson-details-label" htmlFor="lesson-write-body" lang={language}>{label}</label>
    <textarea id="lesson-write-body" className="lesson-write-body" rows={9} ref={target} readOnly aria-label={label} defaultValue={editorHtml(value, language, images.urls)} />
    {failed && <p role="alert">{t("lessons.richEditorError")}</p>}
    {imageStage && <div className="lesson-image-progress" role="status"><progress aria-label={t(`lessons.image.${imageStage}`)} /><span>{t(`lessons.image.${imageStage}`)}</span></div>}
  </div>;
}
