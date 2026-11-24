use ::renderer::{Camera, Explosion};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use super::AnatomyViewer;
use super::background_bounds;
use super::io::{load_packages, prepared_buffers};
use super::util::js_error;

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn background(canvas: HtmlCanvasElement) -> Result<AnatomyViewer, JsValue> {
        let mut viewer = Self::build(
            canvas,
            ::renderer::PackedScene {
                scene: ::renderer::Scene {
                    parts: Vec::new(),
                    bounds: background_bounds(),
                    selected: String::new(),
                },
                draws: Vec::new(),
                vertex_count: 0,
                index_count: 0,
                overview_framing: None,
            },
            js_sys::Float32Array::new_with_length(0),
            js_sys::Uint32Array::new_with_length(0),
        )?;
        viewer.background_camera = Some(viewer.camera.clone());
        Ok(viewer)
    }

    #[wasm_bindgen(constructor)]
    pub fn new(
        canvas: HtmlCanvasElement,
        bytes: &[u8],
        ids_json: &str,
    ) -> Result<AnatomyViewer, JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        let scene = ::renderer::Scene::from_glb(bytes, &ids).map_err(js_error)?;
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
        let known: HashSet<_> = self
            .scene
            .parts
            .iter()
            .map(|part| &part.source_id)
            .collect();
        if packed
            .scene
            .parts
            .iter()
            .all(|part| known.contains(&part.source_id))
        {
            return Ok(());
        }
        let vao = self.gpu.upload(vertices, indices)?;
        let first = self.scene.parts.len();
        if first == 0 {
            self.scene.bounds = packed.scene.bounds;
        }
        for index in self.scene.append(packed.scene) {
            let (count, offset) = packed.draws[index];
            self.draws.push((vao, count, offset));
        }
        self.reconstruction
            .append(&self.scene.parts[first..], self.scene.bounds, now, animate)
            .map_err(js_error)?;
        self.overview_framing = None;
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
