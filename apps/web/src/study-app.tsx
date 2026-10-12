import { useState } from "react";
import type { Catalog, StudyTarget } from "./core";
import { ModelViewer } from "./model-viewer";

export function StudyApp({ catalog }: { catalog: Catalog }) {
  const [groupId, setGroupId] = useState(catalog.groups[0]?.id);
  const [targetId, setTargetId] = useState<string>();
  const group = catalog.groups.find(item => item.id === groupId);
  const targets = catalog.targets.filter(item => item.group_id === groupId);
  const root = targets.find(item => !item.parent_id);
  const target = targets.find(item => item.id === targetId) ?? root;
  const children = targets.filter(item => item.parent_id === target?.id);
  const ancestors: StudyTarget[] = [];
  let parent = target;
  while (parent) {
    ancestors.unshift(parent);
    const parentId = parent.parent_id;
    parent = targets.find(item => item.id === parentId);
  }
  return (
    <div className="study-shell">
      <a className="skip-link" href="#workspace">Đến không gian tự học</a>
      <aside className="catalog-panel">
        <div className="brand"><span className="brand-mark" aria-hidden="true">H</span><div>HUMAN ATLAS<small>Không gian tự học giải phẫu</small></div></div>
        <div className="catalog-heading"><h2>Danh mục</h2><span>{catalog.groups.length} nhóm</span></div>
        <nav aria-label="Các nhóm giải phẫu">
          {catalog.groups.map((item, index) => (
            <button className="group-button" key={item.id} aria-current={item.id === groupId ? "true" : undefined} onClick={() => { setGroupId(item.id); setTargetId(undefined); }}>
              <span className="group-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span>{item.title}<small>{catalog.targets.find(t => t.group_id === item.id && !t.parent_id)?.source_name}</small></span>
            </button>
          ))}
        </nav>
        <p className="catalog-note">Khám phá từng phần.<br />Hiểu cơ thể trong tổng thể.</p>
      </aside>
      <main id="workspace" tabIndex={-1}>
        <header className="workspace-header"><span>GIẢI PHẪU NGƯỜI</span><span>Tự học theo cấu trúc</span></header>
        <section className="workspace-title">
          <p className="eyebrow">{group?.title}</p>
          <h1>{target?.title ?? group?.title}</h1>
          <p>Đi sâu theo các nhóm của Z-Anatomy, rồi chọn từng cấu trúc để xem hình dạng và thông tin.</p>
        </section>
        <nav className="breadcrumbs" aria-label="Đường dẫn danh mục">
          {ancestors.map(item => <button key={item.id} aria-current={item.id === target?.id ? "page" : undefined} onClick={() => setTargetId(item.id)}>{item.title}</button>)}
        </nav>
        <section className="subcategories" aria-label="Danh mục phụ">
          <h2>{children.length ? "Danh mục phụ" : "Cấu trúc trong danh mục"}</h2>
          <p>{target?.source_name} · {target?.structure_ids.length ?? 0} cấu trúc có hình học</p>
          <nav className="target-tabs" aria-label="Các danh mục phụ">
            {children.map(item => <button key={item.id} onClick={() => setTargetId(item.id)}>{item.title}<small>{item.structure_ids.length ? item.structure_ids.length + " cấu trúc" : "Chưa gắn hình học"}</small></button>)}
          </nav>
          {children.length === 0 && <p>Chọn một cấu trúc trong mô hình hoặc danh sách bên dưới để học chi tiết.</p>}
        </section>
        <section className="model-space has-model" aria-label="Không gian mô hình giải phẫu">
          {root?.model && target && <ModelViewer key={groupId} model={root.model} title={group?.title ?? root.title} target={target} />}
        </section>
        <footer className="workspace-footer"><span>{catalog.groups.length} danh mục chính · {catalog.targets.length - catalog.groups.length} danh mục phụ</span><span>Giải phẫu tham chiếu · Người trưởng thành</span></footer>
      </main>
    </div>
  );
}
