import { createRoot } from "react-dom/client";
import { StudyApp } from "./study-app";
import { getCatalog } from "./core";
import "./style.css";

const root = createRoot(document.getElementById("root")!);
root.render(<main className="startup" role="status">Đang mở danh mục giải phẫu…</main>);

getCatalog().then(
  (catalog) => root.render(<StudyApp catalog={catalog} />),
  (error: unknown) => {
    console.error("Catalog initialization failed", error);
    root.render(
      <main className="startup" role="alert">
        <h1>Không thể mở danh mục</h1>
        <p>Hãy tải lại ứng dụng để thử lại.</p>
        <button onClick={() => window.location.reload()}>Tải lại</button>
      </main>,
    );
  },
);
