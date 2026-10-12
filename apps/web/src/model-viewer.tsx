import { useEffect, useRef, useState } from "react";
import { AmbientLight, Box3, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from "three";
import type { Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Model, StudyTarget } from "./core";

interface Structure { source_id: string; source_name: string; source_object: string; definition_key: string; latin: string; laterality: string; collections: string[] }
interface Definition { text: string; links: string[] }

function disposeModel(object: Object3D) {
  object.traverse(child => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      for (const material of [child.material].flat()) material.dispose();
    }
  });
}

export function ModelViewer({ model, title, target }: { model: Model; title: string; target: StudyTarget }) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef<OrbitControls | null>(null);
  const selectMesh = useRef<(id: string) => void>(() => {});
  const inspectMesh = useRef<(action: "focus" | "isolate" | "hide" | "all" | "reset") => void>(() => {});
  const applySubset = useRef<(ids: string[]) => void>(() => {});
  const latestTarget = useRef(target);
  latestTarget.current = target;
  const [collectionDefinitions, setCollectionDefinitions] = useState<Record<string, Definition>>({});
  const [status, setStatus] = useState("Đang nạp mô hình…");
  const [error, setError] = useState(false);
  const [meshes, setMeshes] = useState<Structure[]>([]);
  const [definitions, setDefinitions] = useState<Record<string, Definition>>({});
  const [selected, setSelected] = useState("");
  const [visibleCount, setVisibleCount] = useState(0);
  useEffect(() => {
    const container = host.current!;
    const abort = new AbortController();
    let disposed = false;
    let object: Object3D | undefined;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(true); setStatus("Không thể khởi tạo WebGL. Hãy thử trình duyệt có hỗ trợ 3D.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", `Mô hình 3D ${title}. Kéo để xoay, cuộn để phóng to. Có nút điều khiển và danh sách cấu trúc bên dưới.`);
    container.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(38, 1, 0.001, 100);
    scene.add(new AmbientLight(0xffffff, 1.8));
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(2, 3, 4); scene.add(light);
    const orbit = new OrbitControls(camera, renderer.domElement);
    controls.current = orbit;
    const render = () => { if (!disposed) renderer.render(scene, camera); };
    orbit.addEventListener("change", render);
    let radius = 1;
    let viewBounds: Box3 | undefined;
    function fit(bounds?: Box3) {
      viewBounds = bounds;
      const center = bounds?.getCenter(new Vector3()) ?? new Vector3();
      const viewRadius = bounds ? bounds.getSize(new Vector3()).length() / 2 : radius;
      const fov = camera.fov * Math.PI / 180;
      const limitingFov = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect));
      const distance = viewRadius / Math.sin(limitingFov / 2) * 1.12;
      camera.position.copy(center).add(new Vector3(0, 0, distance));
      camera.near = Math.max(viewRadius / 100, 0.000001); camera.far = radius * 100;
      camera.updateProjectionMatrix();
      orbit.target.copy(center); orbit.minDistance = viewRadius * 0.1; orbit.maxDistance = radius * 15;
      orbit.update(); render();
    }
    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        renderer.setSize(width, height); camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if (object) fit(viewBounds);
      }
    });
    observer.observe(container);
    const parts: Mesh[] = [];
    let selectedId = "";
    let activeIds = new Set<string>();
    const fitActive = () => {
      const bounds = new Box3();
      parts.filter(part => activeIds.has(part.userData.source_id)).forEach(part => bounds.union(new Box3().setFromObject(part)));
      if (!bounds.isEmpty()) fit(bounds); else render();
    };
    const highlight = (id: string) => {
      selectedId = id;
      setSelected(id);
      for (const part of parts) {
        for (const material of [part.material].flat()) {
          if (material instanceof MeshStandardMaterial) material.emissive.set(part.userData.source_id === id ? 0x563c14 : 0x000000);
        }
      }
      render();
    };
    applySubset.current = ids => {
      activeIds = new Set(ids);
      parts.forEach(part => { part.visible = activeIds.has(part.userData.source_id); });
      highlight(""); fitActive();
      setVisibleCount(new Set(parts.filter(part => part.visible).map(part => part.userData.source_id)).size);
    };
    selectMesh.current = highlight;
    inspectMesh.current = action => {
      const selectedParts = parts.filter(mesh => mesh.userData.source_id === selectedId);
      if (action === "reset") fit(viewBounds);
      else if (action === "all") {
        parts.forEach(mesh => { mesh.visible = activeIds.has(mesh.userData.source_id); }); fitActive();
      } else if (selectedParts.length) {
        if (action === "isolate") parts.forEach(mesh => { mesh.visible = mesh.userData.source_id === selectedId; });
        if (action === "hide") selectedParts.forEach(part => { part.visible = false; });
        else {
          const bounds = new Box3();
          selectedParts.forEach(part => { part.visible = true; bounds.union(new Box3().setFromObject(part)); });
          fit(bounds);
        }
      }
      setVisibleCount(new Set(parts.filter(mesh => mesh.visible).map(mesh => mesh.userData.source_id)).size); render();
    };
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    let down = new Vector2();
    const pointerDown = (event: PointerEvent) => { down = new Vector2(event.clientX, event.clientY); };
    const pointerUp = (event: PointerEvent) => {
      if (down.distanceTo(new Vector2(event.clientX, event.clientY)) > 5) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      highlight(raycaster.intersectObjects(parts.filter(part => part.visible), false)[0]?.object.userData.source_id ?? "");
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    const contextLost = (event: Event) => {
      event.preventDefault(); setError(true); setStatus("Kết nối hiển thị 3D bị mất. Hãy tải lại trang.");
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    (async () => {
      try {
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
        const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
        if (disposed) { disposeModel(gltf.scene); return; }
        object = gltf.scene;
        object.traverse(child => {
          if (!(child instanceof Mesh)) return;
          let owner: Object3D | null = child;
          while (owner && !owner.userData.source_id) owner = owner.parent;
          if (!owner) throw new Error("Mesh không có định danh cấu trúc");
          child.userData = owner.userData;
          const originals = [child.material].flat();
          const materials = originals.map(material => material.clone());
          child.material = Array.isArray(child.material) ? materials : materials[0]!;
          originals.forEach(material => material.dispose());
          parts.push(child);
        });
        if (parts.length === 0) throw new Error("Mô hình không có mesh");
        const identities = new Set(parts.map(part => part.userData.source_id));
        if (identities.size !== metadata.structures.length || !metadata.structures.every(s => identities.has(s.source_id))) throw new Error("Hình học và metadata không khớp");
        const bounds = new Box3().setFromObject(object);
        const center = bounds.getCenter(new Vector3());
        radius = bounds.getSize(new Vector3()).length() / 2;
        if (!Number.isFinite(radius) || radius <= 0) throw new Error("Kích thước mô hình không hợp lệ");
        object.position.sub(center); scene.add(object);
        setMeshes(metadata.structures.sort((a, b) => a.source_name.localeCompare(b.source_name) || a.source_object.localeCompare(b.source_object)));
        setDefinitions(metadata.definitions); setCollectionDefinitions(metadata.collection_definitions);
        setStatus("Đã nạp mô hình"); applySubset.current(latestTarget.current.structure_ids);
      } catch (cause) {
        if (!disposed) { console.error(cause); setError(true); setStatus("Không nạp được mô hình. Hãy tải lại trang để thử lại."); }
      }
    })();
    return () => {
      disposed = true; abort.abort(); observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      selectMesh.current = () => {}; inspectMesh.current = () => {}; applySubset.current = () => {}; controls.current = null;
      orbit.dispose(); if (object) disposeModel(object);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [model.path, title]);
  useEffect(() => { applySubset.current(target.structure_ids); }, [target.id]);
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
        <button disabled={!scopedMeshes.length || error} onClick={() => controls.current?.rotateLeft(Math.PI / 8)}>Xoay trái</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => controls.current?.rotateLeft(-Math.PI / 8)}>Xoay phải</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => controls.current?.rotateUp(Math.PI / 8)}>Xoay lên</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => controls.current?.dollyIn(1 / 1.2)}>Phóng to</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => controls.current?.dollyOut(1 / 1.2)}>Thu nhỏ</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => inspectMesh.current("reset")}>Đặt lại góc nhìn</button>
      </div>
      <div className="structure-picker">
        <label htmlFor="structure">Cấu trúc · Tên tiếng Anh từ nguồn</label>
        <select id="structure" value={selected} disabled={!scopedMeshes.length || error} onChange={event => selectMesh.current(event.target.value)}>
          <option value="">Chọn trên mô hình hoặc từ danh sách</option>
          {scopedMeshes.map(part => <option key={part.source_id} value={part.source_id}>{part.source_name}{side(part)}</option>)}
        </select>
        <p aria-live="polite">{selectedPart ? `${selectedPart.source_name}${side(selectedPart)}${selectedPart.latin ? ` · ${selectedPart.latin}` : ""}` : "Kéo để xoay · Cuộn hoặc chụm hai ngón để thay đổi độ phóng đại"}</p>
      </div>
      <div className="model-controls" aria-label="Khám phá cấu trúc đã chọn">
        <button disabled={!selectedPart || error} onClick={() => inspectMesh.current("focus")}>Phóng tới cấu trúc</button>
        <button disabled={!selectedPart || error} onClick={() => inspectMesh.current("isolate")}>Xem riêng cấu trúc</button>
        <button disabled={!selectedPart || error} onClick={() => inspectMesh.current("hide")}>Ẩn cấu trúc</button>
        <button disabled={!scopedMeshes.length || error} onClick={() => inspectMesh.current("all")}>Hiện tất cả</button>
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
