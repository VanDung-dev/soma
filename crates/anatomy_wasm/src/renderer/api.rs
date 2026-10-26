use anatomy_renderer::{Camera, Explosion};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use super::AnatomyViewer;
use super::io::{load_packages, prepared_buffers};
use super::util::js_error;

#[wasm_bindgen]
impl AnatomyViewer {
    #[wasm_bindgen(constructor)]
    pub fn new(
        canvas: HtmlCanvasElement,
        bytes: &[u8],
        ids_json: &str,
    ) -> Result<AnatomyViewer, JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        let scene = anatomy_renderer::Scene::from_glb(bytes, &ids).map_err(js_error)?;
        Self::from_scene(canvas, scene)
    }

    #[wasm_bindgen(js_name = fromPackages)]
    pub fn from_packages(
        canvas: HtmlCanvasElement,
        packages: js_sys::Array,
        ids_json: &str,
    ) -> Result<AnatomyViewer, JsValue> {
        Self::from_scene(canvas, load_packages(packages, ids_json)?)
    }

    #[wasm_bindgen(js_name = fromPrepared)]
    pub fn from_prepared(
        canvas: HtmlCanvasElement,
        prepared: js_sys::Array,
    ) -> Result<AnatomyViewer, JsValue> {
        let (packed, vertices, indices) = prepared_buffers(prepared)?;
        Self::from_buffers(canvas, packed, vertices, indices)
    }

    #[wasm_bindgen(js_name = appendPrepared)]
    pub fn append_prepared(
        &mut self,
        prepared: js_sys::Array,
        now: f64,
        animate: bool,
    ) -> Result<(), JsValue> {
        if self.exploding {
            return Err(js_error("Leave explosion mode before appending geometry"));
        }
        self.reconstruction.check_time(now).map_err(js_error)?;
        let (packed, vertices, indices) = prepared_buffers(prepared)?;
        let vao = self.gpu.upload(vertices, indices)?;
        let first = self.scene.parts.len();
        for index in self.scene.append(packed.scene) {
            let (count, offset) = packed.draws[index];
            self.draws.push((vao, count, offset));
        }
        self.reconstruction
            .append(&self.scene.parts[first..], self.scene.bounds, now, animate)
            .map_err(js_error)?;
        self.camera = Camera::new(self.scene.bounds);
        self.explosion = Explosion::default();
        self.shadow_cached.set(false);
        self.camera
            .resize(self.canvas.width(), self.canvas.height());
        Ok(())
    }

    pub fn render(&self) {
        self.draw(false);
    }
}
