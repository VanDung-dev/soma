import { useEffect, useEffectEvent, useRef, useState } from "react";
import tinymce from "tinymce";
import "tinymce/icons/default";
import "tinymce/themes/silver";
import "tinymce/models/dom";
import "tinymce/plugins/lists";
import "tinymce/plugins/link";
import "tinymce/plugins/table";
import "tinymce/skins/ui/oxide/skin.js";
import "tinymce/skins/ui/oxide/content.js";
import "tinymce/skins/ui/oxide-dark/skin.js";
import "tinymce/skins/ui/oxide-dark/content.js";
import type { Editor } from "tinymce";
import type { LessonText } from "./contract";
import type { Language } from "../i18n";
import { useLanguage } from "../i18n";
import { editorHtml, lessonElements, sanitizeLessonHtml } from "./rich-text";

export default function RichEditor({ value, language, label, onChange }: {
  value: LessonText; language: Language; label: string; onChange: (value: LessonText) => void;
}) {
  const { t } = useLanguage();
  const target = useRef<HTMLTextAreaElement>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState(document.documentElement.dataset.theme);
  const content = useEffectEvent(() => editorHtml(value, language));
  const change = useEffectEvent((html: string) => onChange({ ...value, [language]: sanitizeLessonHtml(html),
    html: [...new Set([...(value.html ?? []), language])] }));
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(document.documentElement.dataset.theme));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    let instance: Editor | undefined;
    setFailed(false);
    const palette = getComputedStyle(document.documentElement);
    void tinymce.init({
      target: target.current!, license_key: "gpl", skin: mode === "dark" ? "oxide-dark" : "oxide",
      content_css: false, promotion: false, menubar: false, height: 300, min_height: 220,
      plugins: "lists link table", toolbar: "undo redo | blocks | bold italic underline | bullist numlist | link table | removeformat",
      toolbar_mode: "sliding", block_formats: "Paragraph=p;Heading 2=h2;Heading 3=h3;Heading 4=h4",
      valid_elements: lessonElements, entity_encoding: "raw", paste_data_images: false,
      browser_spellcheck: true, iframe_aria_text: label,
      content_style: `body{font:14px/1.6 system-ui;margin:12px;color:${palette.getPropertyValue("--text")};background:${palette.getPropertyValue("--surface")}}p{margin:0 0 12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:6px}a{color:${palette.getPropertyValue("--accent")}}`,
      setup(editor) {
        instance = editor;
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
  }, [mode, label]);
  return <div className="lesson-rich-editor">
    <textarea id="lesson-write-body" className="lesson-write-body" rows={9} ref={target} readOnly aria-label={label} defaultValue={editorHtml(value, language)} />
    {failed && <p role="alert">{t("lessons.richEditorError")}</p>}
  </div>;
}
