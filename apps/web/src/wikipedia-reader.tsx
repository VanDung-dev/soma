import { useEffect, useId, useRef, useState } from "react";
import references from "../../../content/wikipedia-references.json";

const articles: Record<string, { url: string; status: string }> = references.articles;

export function wikipediaReference(name: string) {
  const article = Object.hasOwn(articles, name) ? articles[name] : undefined;
  if (!article) return undefined;
  const url = new URL(article.url);
  if (url.protocol !== "https:" || url.host !== "en.wikipedia.org" || !url.pathname.startsWith("/wiki/") || url.search) return undefined;
  return article;
}

export function WikipediaReader({ name }: { name: string }) {
  const article = wikipediaReference(name);
  const [reload, setReload] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const notesId = useId();
  const notes = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notesOpen) notes.current?.scrollIntoView({ block: "nearest" });
  }, [notesOpen]);
  const search = `https://en.wikipedia.org/w/index.php?title=Special:Search&fulltext=1&search=${encodeURIComponent(name.replace(/^[1-9]:\s*/, ""))}`;
  return <section className="wikipedia-reader" aria-label={`Wikipedia: ${name}`}>
    {article ? <iframe key={`${article.url}:${reload}`} src={article.url} title={`Bài Wikipedia về ${name}`}
      sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />
      : <p>Chưa gắn bài Wikipedia cho cấu trúc này. <a href={search} target="_blank" rel="noreferrer">Tìm “{name}” trên Wikipedia ↗</a></p>}
    <div className="reader-actions">
      <h3>Wikipedia<button className="reader-info" aria-label="Thông tin về Wikipedia" aria-expanded={notesOpen}
        aria-controls={notesId} onClick={() => setNotesOpen(value => !value)}>i</button></h3>
      {article && <>
        <button onClick={() => setReload(value => value + 1)}>Về bài của bộ phận</button>
        <a href={article.url} target="_blank" rel="noreferrer">Mở bài gốc ↗</a>
      </>}
    </div>
    <div ref={notes} id={notesId} className="reader-notes" hidden={!notesOpen}>
      {article && <p className="reader-note">Khung đọc cần kết nối mạng. Nếu trang không hiển thị, hãy dùng liên kết mở bài gốc ở trên.</p>}
      <p className="reference-notice">Wikipedia chỉ phục vụ tham khảo và học tập; thông tin có thể sai hoặc chưa cập nhật, không thay thế tài liệu chuyên môn hoặc tư vấn y tế.</p>
    </div>
    {article && <details className="reference-mapping" onToggle={event => {
        if (event.currentTarget.open) event.currentTarget.scrollIntoView({ block: "nearest" });
      }}>
        <summary>Về liên kết tham khảo</summary>
        <div className="reference-mapping-description">
          <p>Liên kết được giữ từ metadata nguồn, chưa được đối chiếu độc lập; bài có thể mô tả phạm vi rộng hơn bộ phận này.</p>
        </div>
      </details>}
  </section>;
}
