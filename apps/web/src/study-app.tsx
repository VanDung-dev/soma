import type { Catalog } from "./core";
import { ModelViewer } from "./model-viewer";

export function StudyApp({ catalog }: { catalog: Catalog }) {
  return (
    <div className="study-shell">
      <a className="skip-link" href="#workspace">Đến mô hình giải phẫu</a>
      <ModelViewer catalog={catalog} />
    </div>
  );
}
