import { useEffect, useRef, useState } from "react";
import { getWasm } from "./core";
import type { Model, StudyTarget } from "./core";
import type { AnatomyViewer } from "./wasm/anatomy_wasm";

interface Structure { source_id: string; source_name: string; source_object: string; definition_key: string; latin: string; laterality: string; collections: string[] }
interface Definition { text: string; links: string[] }

export function ModelViewer({ model, title, target }: { model: Model; title: string; target: StudyTarget }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<AnatomyViewer | null>(null);
  const latestTarget = useRef(target);
  latestTarget.current = target;
  const [collectionDefinitions, setCollectionDefinitions] = useState<Record<string, Definition>>({});
  const [status, setStatus] = useState("Đang nạp mô hình…");
  const [error, setError] = useState(false);
  const [meshes, setMeshes] = useState<Structure[]>([]);
  const [definitions, setDefinitions] = useState<Record<string, Definition>>({});
  const [selected, setSelected] = useState("");
  const [visibleCount, setVisibleCount] = useState(0);
  const operate = (action: (renderer: AnatomyViewer) => void) => {
    const renderer = viewer.current;
    if (!renderer) return;
    try {
      action(renderer);
      setSelected(renderer.selected_id()); setVisibleCount(renderer.visible_count());
    } catch (cause) {
      console.error(cause); setError(true); setStatus("Không thể xử lý mô hình. Hãy tải lại trang để thử lại.");
    }
  };
  useEffect(() => {
    const container = host.current!;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Mô hình 3D ${title}. Kéo để xoay, cuộn để phóng to. Có nút điều khiển và danh sách cấu trúc bên dưới.`);
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
      canvas.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      if (!pointers.size) { down = point; dragged = false; }
      else dragged = true;
      pointers.set(event.pointerId, point);
    };
    const pointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
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
        const bounds = canvas.getBoundingClientRect();
        const x = Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width);
        const y = canvas.height - 1 - Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height);
        if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) operate(renderer => { renderer.pick(x, y); });
      }
      pointers.delete(event.pointerId);
    };
    const pointerCancel = (event: PointerEvent) => { pointers.delete(event.pointerId); dragged = true; };
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
    canvas.addEventListener("lostpointercapture", pointerCancel);
    canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("contextmenu", contextMenu);
    canvas.addEventListener("webglcontextlost", contextLost);
    (async () => {
      try {
        const [response, metadataResponse, wasm] = await Promise.all([
          fetch(`${import.meta.env.BASE_URL}${model.path}`, { signal: abort.signal }),
          fetch(`${import.meta.env.BASE_URL}${model.path.replace(/\.glb$/, ".json")}`, { signal: abort.signal }),
          getWasm(),
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
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (disposed) return;
        viewer.current = new wasm.AnatomyViewer(canvas, bytes, JSON.stringify(metadata.structures.map(s => s.source_id)));
        resize();
        operate(renderer => renderer.subset(JSON.stringify(latestTarget.current.structure_ids)));
        setMeshes(metadata.structures.sort((a, b) => a.source_name.localeCompare(b.source_name) || a.source_object.localeCompare(b.source_object)));
        setDefinitions(metadata.definitions); setCollectionDefinitions(metadata.collection_definitions);
        setStatus("Đã nạp mô hình");
      } catch (cause) {
        if (!disposed) { console.error(cause); setError(true); setStatus("Không nạp được mô hình. Hãy tải lại trang để thử lại."); }
      }
    })();
    return () => {
      disposed = true; abort.abort(); observer.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp); canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel);
      canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("contextmenu", contextMenu);
      canvas.removeEventListener("webglcontextlost", contextLost);
      viewer.current?.free(); viewer.current = null; canvas.remove();
    };
  }, [model.path, title]);
  useEffect(() => { operate(renderer => renderer.subset(JSON.stringify(target.structure_ids))); }, [target.id]);
  const activeIds = new Set(target.structure_ids);
  const scopedMeshes = meshes.filter(part => activeIds.has(part.source_id));
  const categoryDefinition = collectionDefinitions[target.definition_key];
  const selectedPart = scopedMeshes.find(part => part.source_id === selected);
  const definition = selectedPart ? definitions[selectedPart.definition_key] : undefined;
  const side = (part: Structure) => part.laterality === "left" ? " · trái" : part.laterality === "right" ? " · phải" : "";
  return (
    <div className="model-viewer">
      <div className="space-label">Z-ANATOMY · THAM CHIẾU NAM TRƯỞNG THÀNH</div>
      <div className="model-canvas" ref={host} />
      <p className={`model-status${error ? " model-error" : ""}`} role={error ? "alert" : "status"}>{!error && meshes.length ? `${scopedMeshes.length} cấu trúc trong nhóm` : status}</p>
      {!error && meshes.length > 0 && scopedMeshes.length === 0 && <p className="model-scope">Chưa có hình học gắn với nhánh này trong danh mục hiện tại. Bạn vẫn có thể đọc thông tin hoặc quay về nhóm cha.</p>}
      {categoryDefinition && <section className="structure-description" aria-label="Thông tin danh mục"><details key={target.id}><summary>Thông tin về {target.title} · tiếng Anh</summary><p className="definition-text">{categoryDefinition.text}</p><p>{categoryDefinition.links.map(link => <a key={link} href={link} target="_blank" rel="noreferrer">Nguồn: {link}</a>)}</p></details></section>}
      <div className="model-controls" aria-label="Điều khiển mô hình">
        <button disabled={!scopedMeshes.length || error} onClick={() => operate(renderer => renderer.rotate(-Math.PI / 8, 0))}>Xoay trái</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => operate(renderer => renderer.rotate(Math.PI / 8, 0))}>Xoay phải</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => operate(renderer => renderer.rotate(0, Math.PI / 8))}>Xoay lên</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => operate(renderer => renderer.zoom(1 / 1.2))}>Phóng to</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => operate(renderer => renderer.zoom(1.2))}>Thu nhỏ</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => operate(renderer => renderer.inspect("reset"))}>Đặt lại góc nhìn</button>
      </div>
      <div className="structure-picker">
        <label htmlFor="structure">Cấu trúc · Tên tiếng Anh từ nguồn</label>
        <select id="structure" value={selected} disabled={!scopedMeshes.length || error} onChange={event => operate(renderer => renderer.select(event.target.value))}>
          <option value="">Chọn trên mô hình hoặc từ danh sách</option>
          {scopedMeshes.map(part => <option key={part.source_id} value={part.source_id}>{part.source_name}{side(part)}</option>)}
        </select>
        <p aria-live="polite">{selectedPart ? `${selectedPart.source_name}${side(selectedPart)}${selectedPart.latin ? ` · ${selectedPart.latin}` : ""}` : "Kéo để xoay · Cuộn hoặc chụm hai ngón để thay đổi độ phóng đại"}</p>
      </div>
      <div className="model-controls" aria-label="Khám phá cấu trúc đã chọn">
        <button disabled={!selectedPart || error} onClick={() => operate(renderer => renderer.inspect("focus"))}>Phóng tới cấu trúc</button>
        <button disabled={!selectedPart || error} onClick={() => operate(renderer => renderer.inspect("isolate"))}>Xem riêng cấu trúc</button>
        <button disabled={!selectedPart || error} onClick={() => operate(renderer => renderer.inspect("hide"))}>Ẩn cấu trúc</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => operate(renderer => renderer.inspect("all"))}>Hiện tất cả</button>
        <span role="status">{visibleCount}/{scopedMeshes.length} cấu trúc đang hiện</span>
      </div>
      <section className="structure-description" aria-label="Thông tin cấu trúc">
        {selectedPart ? <>
          <p>{selectedPart.collections.filter(name => !/^\d:/.test(name)).join(" · ")}</p>
          {definition ? <details key={selectedPart.source_id}><summary>Đọc thông tin về {selectedPart.source_name} · tiếng Anh</summary><p className="definition-text">{definition.text}</p><p>{definition.links.filter(link => /^https?:\/\//.test(link)).map(link => <a key={link} href={link} target="_blank" rel="noreferrer">Nguồn: {link}</a>)}</p></details> : <p>Nguồn chưa có định nghĩa gắn với cấu trúc này.</p>}
        </> : <p>Chọn một cấu trúc để đọc tên Latin, nhóm liên quan và định nghĩa từ nguồn.</p>}
      </section>
      <p className="model-scope">{model.scope} Vật liệu PBR giữ màu nền từ nguồn; shader Blender được chuyển gần đúng cho web.</p>
      <p className="model-credit">Z-Anatomy — Gauthier Kervyn và các tác giả, phát triển từ BodyParts3D. Nội dung dẫn xuất theo CC BY-SA 4.0 và các ghi nhận nguồn thành phần; định nghĩa chủ yếu dựa trên Wikipedia. <a href={`${import.meta.env.BASE_URL}models/z-anatomy/ATTRIBUTION.md`} target="_blank" rel="noreferrer">Nguồn, giấy phép và các thay đổi</a></p>
    </div>
  );
}
