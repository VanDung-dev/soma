import { useEffect, useRef, useState } from "react";
import { getWasm } from "./core";
import type { Catalog } from "./core";
import { StructureTree } from "./structure-tree";
import type { AnatomyViewer } from "./wasm/anatomy_wasm";

export interface Structure { source_id: string; source_name: string; source_object: string; definition_key: string; latin: string; laterality: string; collections: string[] }
interface Definition { text: string; links: string[] }

export function ModelViewer({ catalog }: { catalog: Catalog }) {
  const roots = catalog.targets.filter(target => !target.parent_id && target.model);
  const [targetId, setTargetId] = useState<string>();
  const target = catalog.targets.find(target => target.id === targetId);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<AnatomyViewer | null>(null);

  const [collectionDefinitions, setCollectionDefinitions] = useState<Record<string, Definition>>({});
  const [status, setStatus] = useState("Đang nạp mô hình…");
  const [error, setError] = useState(false);
  const [meshes, setMeshes] = useState<Structure[]>([]);
  const [definitions, setDefinitions] = useState<Record<string, Definition>>({});
  const [selected, setSelected] = useState("");
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const operate = (action: (renderer: AnatomyViewer) => void) => {
    const renderer = viewer.current;
    if (!renderer) return;
    try {
      action(renderer);
      setSelected(renderer.selected_id());
    } catch (cause) {
      console.error(cause); setError(true); setStatus("Không thể xử lý mô hình. Hãy tải lại trang để thử lại.");
    }
  };
  useEffect(() => {
    const container = host.current!;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Mô hình 3D cơ thể người. Kéo để xoay, cuộn để phóng to, trỏ vào để xem thông tin. Cây cấu trúc và nút điều khiển hỗ trợ bàn phím.");
    container.appendChild(canvas);
    const abort = new AbortController();
    let disposed = false;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        const ratio = Math.min(window.devicePixelRatio, 2);
        operate(renderer => renderer.resize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))));
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const pointers = new Map<number, { x: number; y: number }>();
    let down = { x: 0, y: 0 };
    let dragged = false;
    const pointerDown = (event: PointerEvent) => {
      clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined;
      canvas.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      if (!pointers.size) { down = point; dragged = false; }
      else dragged = true;
      pointers.set(event.pointerId, point);
    };
    const pick = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const x = Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width);
      const y = canvas.height - 1 - Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height);
      if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) operate(renderer => { renderer.pick(x, y); });
    };
    let hoverTimer = 0;
    let hoverEvent: PointerEvent | undefined;
    const pointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) {
        if (event.pointerType === "mouse") {
          hoverEvent = event;
          if (!hoverTimer) hoverTimer = window.setTimeout(() => {
            hoverTimer = 0;
            if (!pointers.size && hoverEvent) pick(hoverEvent);
          }, 100);
        }
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
      const dx = point.x - previous.x, dy = point.y - previous.y;
      if (Math.hypot(point.x - down.x, point.y - down.y) > 5) dragged = true;
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(point.x - other.x, point.y - other.y);
        if (before > 1 && after > 1) operate(renderer => renderer.zoom(before / after));
        operate(renderer => renderer.pan(-dx / canvas.clientHeight / 2, dy / canvas.clientHeight / 2));
      } else if (event.button === 2 || (event.buttons & 2) || event.shiftKey) {
        operate(renderer => renderer.pan(-dx / canvas.clientHeight, dy / canvas.clientHeight));
      } else operate(renderer => renderer.rotate(-dx / canvas.clientHeight * Math.PI * 2, dy / canvas.clientHeight * Math.PI * 2));
      pointers.set(event.pointerId, point);
    };
    const pointerUp = (event: PointerEvent) => {
      if (pointers.has(event.pointerId) && pointers.size === 1 && !dragged && event.button !== 2) {
        pick(event);
      }
      pointers.delete(event.pointerId);
    };
    const pointerCancel = (event: PointerEvent) => { pointers.delete(event.pointerId); dragged = true; };
    const pointerLeave = () => { clearTimeout(hoverTimer); hoverTimer = 0; hoverEvent = undefined; };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      operate(renderer => renderer.zoom(Math.exp(Math.max(-1, Math.min(1, pixels * 0.001)))));
    };
    const contextMenu = (event: Event) => event.preventDefault();
    const contextLost = (event: Event) => {
      event.preventDefault(); setError(true); setStatus("Kết nối hiển thị 3D bị mất. Hãy tải lại trang.");
    };
    canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp); canvas.addEventListener("pointercancel", pointerCancel);
    canvas.addEventListener("lostpointercapture", pointerCancel); canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("contextmenu", contextMenu);
    canvas.addEventListener("webglcontextlost", contextLost);
    (async () => {
      try {
        const wasm = await getWasm();
        const packages = await Promise.all(roots.map(async root => {
          const model = root.model!;
          const [response, metadataResponse] = await Promise.all([
            fetch(`${import.meta.env.BASE_URL}${model.path}`, { signal: abort.signal }),
            fetch(`${import.meta.env.BASE_URL}${model.path.replace(/\.glb$/, ".json")}`, { signal: abort.signal }),
          ]);
          if (!response.ok || !metadataResponse.ok) throw new Error(`HTTP ${response.status}/${metadataResponse.status}`);
          const metadata = await metadataResponse.json() as { structures: Structure[]; definitions: Record<string, Definition>; collection_definitions: Record<string, Definition> };
          if (!Array.isArray(metadata.structures) || !metadata.structures.length
            || !metadata.structures.every(s => s && [s.source_id, s.source_name, s.source_object, s.definition_key, s.latin].every(v => typeof v === "string") && s.source_id && s.source_name && ["", "left", "right"].includes(s.laterality) && Array.isArray(s.collections) && s.collections.every(c => typeof c === "string"))
            || new Set(metadata.structures.map(s => s.source_id)).size !== metadata.structures.length
            || !metadata.definitions || Array.isArray(metadata.definitions) || typeof metadata.definitions !== "object"
            || !metadata.collection_definitions || typeof metadata.collection_definitions !== "object" || Array.isArray(metadata.collection_definitions)
            || ![...Object.values(metadata.definitions), ...Object.values(metadata.collection_definitions)].every(d => d && typeof d.text === "string" && Array.isArray(d.links) && d.links.every(link => typeof link === "string" && /^https?:\/\//.test(link)))
            || !metadata.structures.every(s => !s.definition_key || Object.hasOwn(metadata.definitions, s.definition_key))) throw new Error("Metadata không hợp lệ");
          return { bytes: new Uint8Array(await response.arrayBuffer()), metadata };
        }));
        if (disposed) return;
        viewer.current = wasm.AnatomyViewer.fromPackages(canvas, packages.map(pkg => pkg.bytes), JSON.stringify(packages.map(pkg => pkg.metadata.structures.map(s => s.source_id))));
        resize();
        const structures = [...new Map(packages.flatMap(pkg => pkg.metadata.structures).map(part => [part.source_id, part])).values()]
          .sort((a, b) => a.source_name.localeCompare(b.source_name) || a.source_object.localeCompare(b.source_object));
        setMeshes(structures);
        setVisibleIds(new Set(structures.map(part => part.source_id)));
        setDefinitions(Object.assign({}, ...packages.map(pkg => pkg.metadata.definitions)));
        setCollectionDefinitions(Object.assign({}, ...packages.map(pkg => pkg.metadata.collection_definitions)));
        setStatus("Đã nạp mô hình");
      } catch (cause) {
        if (!disposed) { console.error(cause); setError(true); setStatus("Không nạp được mô hình. Hãy tải lại trang để thử lại."); }
      }
    })();
    return () => {
      disposed = true; abort.abort(); observer.disconnect(); clearTimeout(hoverTimer);
      canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel); canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("contextmenu", contextMenu);
      canvas.removeEventListener("webglcontextlost", contextLost);
      viewer.current?.free(); viewer.current = null; canvas.remove();
    };
  }, [catalog]);
  const selectedPart = meshes.find(part => part.source_id === selected);
  const definition = selectedPart ? definitions[selectedPart.definition_key] : target ? collectionDefinitions[target.definition_key] : undefined;
  const side = (part: Structure) => part.laterality === "left" ? " · trái" : part.laterality === "right" ? " · phải" : "";
  const changeVisibility = (ids: string[], shown: boolean) => {
    const next = new Set(visibleIds);
    for (const id of ids) { if (shown) next.add(id); else next.delete(id); }
    operate(renderer => renderer.set_visibility(JSON.stringify([...next])));
    setVisibleIds(next);
  };
  return (
    <>
      <aside className="catalog-panel" aria-label="Cây cấu trúc giải phẫu">
        <div className="catalog-heading"><h2>Cấu trúc</h2><span>{catalog.groups.length} hệ</span></div>
        <p className="tree-help">Mở thư mục để xem các nhánh. Checkbox áp dụng cho toàn bộ cấu trúc trong nhánh, kể cả khi nằm ở nhiều thư mục.</p>
        <div className="tree-actions">
          <button disabled={!meshes.length || error} onClick={() => changeVisibility(meshes.map(p => p.source_id), true)}>Hiện tất cả</button>
          <button disabled={!meshes.length || error} onClick={() => changeVisibility(meshes.map(p => p.source_id), false)}>Ẩn tất cả</button>
        </div>
        <StructureTree catalog={catalog} structures={meshes} visibleIds={visibleIds} selected={selected} targetId={targetId} disabled={!meshes.length || error}
          onVisibility={changeVisibility} onSelect={id => { setTargetId(undefined); operate(renderer => renderer.select(id)); }}
          onTarget={id => { setTargetId(id); operate(renderer => renderer.select("")); }} />
      </aside>
      <main id="workspace" tabIndex={-1}>
        <header className="workspace-header"><span>HUMAN ATLAS</span><span>Giải phẫu người</span></header>
        <h1>Cơ thể trong tổng thể</h1>
        <p className="workspace-intro">Các bộ phận giữ tọa độ gốc. Tích vào cây cấu trúc để ẩn hoặc hiện cùng lúc.</p>
        <section className="model-space" aria-label="Mô hình giải phẫu">
          <div className="model-canvas" ref={host} />
          <p className={`model-status${error ? " model-error" : ""}`} role={error ? "alert" : "status"}>{!error && meshes.length ? `${visibleIds.size}/${meshes.length} cấu trúc đang hiện` : status}</p>
          <div className="model-controls" aria-label="Điều khiển mô hình">
            <button disabled={!meshes.length || error} onClick={() => operate(renderer => renderer.rotate(-Math.PI / 8, 0))}>Xoay trái</button>
            <button disabled={!meshes.length || error} onClick={() => operate(renderer => renderer.rotate(Math.PI / 8, 0))}>Xoay phải</button>
            <button disabled={!meshes.length || error} onClick={() => operate(renderer => renderer.rotate(0, Math.PI / 8))}>Xoay lên</button>
            <button disabled={!meshes.length || error} onClick={() => operate(renderer => renderer.zoom(1 / 1.2))}>Phóng to</button>
            <button disabled={!meshes.length || error} onClick={() => operate(renderer => renderer.zoom(1.2))}>Thu nhỏ</button>
            <button disabled={!meshes.length || error} onClick={() => operate(renderer => renderer.inspect("reset"))}>Đặt lại góc nhìn</button>
          </div>
        </section>
        <p className="model-help">Kéo để xoay · Cuộn để phóng to · Shift + kéo để di chuyển · Trỏ vào để xem thông tin</p>
      </main>
      <aside className="information-panel" aria-label="Thông tin bộ phận">
        <p className="eyebrow">THÔNG TIN GIẢI PHẪU</p>
        <h2>{selectedPart ? selectedPart.source_name + side(selectedPart) : target?.title ?? "Khám phá cơ thể"}</h2>
        {selectedPart ? <>
          {selectedPart.latin && <p className="latin-name">{selectedPart.latin}</p>}
          <p className="collection-names">{selectedPart.collections.filter(name => !/^\d:/.test(name)).join(" · ")}</p>
        </> : <p>Trỏ vào bộ phận trên mô hình hoặc chọn tên trong cây cấu trúc để đọc thông tin.</p>}
        {definition ? <div className="structure-description">
          <p className="eyebrow">ĐỊNH NGHĨA TỪ NGUỒN · TIẾNG ANH</p>
          <p className="definition-text">{definition.text}</p>
          {definition.links.map(link => <a key={link} href={link} target="_blank" rel="noreferrer">Nguồn: {link}</a>)}
        </div> : (selectedPart || target) && <p>Nguồn chưa có định nghĩa gắn với cấu trúc này.</p>}
        <p className="model-credit">Z-Anatomy — Gauthier Kervyn và các tác giả, phát triển từ BodyParts3D. Nội dung dẫn xuất theo CC BY-SA 4.0; định nghĩa chủ yếu dựa trên Wikipedia. <a href={`${import.meta.env.BASE_URL}models/z-anatomy/ATTRIBUTION.md`} target="_blank" rel="noreferrer">Nguồn và giấy phép</a></p>
      </aside>
    </>
  );
}
