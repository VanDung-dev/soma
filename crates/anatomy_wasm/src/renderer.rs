mod api;
mod draw;
mod io;
mod resources;
mod shaders;
mod uniforms;
mod util;

use anatomy_renderer::{Camera, PackedScene, Reconstruction, Scene};
use js_sys::{Float32Array, Uint32Array};
use std::cell::Cell;
use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext as Gl};

use resources::Resources;
use shaders::{FRAGMENT, OUTLINE_FRAGMENT, OUTLINE_VERTEX, SPHERE_FRAGMENT, SPHERE_VERTEX, VERTEX};
use uniforms::{OutlineUniforms, SphereUniforms, Uniforms};
use util::{js_error, program};

#[wasm_bindgen]
pub struct AnatomyViewer {
    pub(crate) gpu: Resources,
    pub(crate) scene: Scene,
    pub(crate) camera: Camera,
    pub(crate) uniforms: Uniforms,
    pub(crate) sphere_uniforms: SphereUniforms,
    pub(crate) outline_uniforms: OutlineUniforms,
    pub(crate) draws: Vec<(usize, i32, i32)>,
    pub(crate) reconstruction: Reconstruction,
    pub(crate) shadow_cached: Cell<bool>,
    pub(crate) canvas: HtmlCanvasElement,
}

impl AnatomyViewer {
    pub(crate) fn from_scene(canvas: HtmlCanvasElement, scene: Scene) -> Result<Self, JsValue> {
        let (packed, vertices, indices) = scene.pack().map_err(js_error)?;
        Self::from_buffers(
            canvas,
            packed,
            Float32Array::from(vertices.as_slice()),
            Uint32Array::from(indices.as_slice()),
        )
    }

    pub(crate) fn from_buffers(
        canvas: HtmlCanvasElement,
        packed: PackedScene,
        vertices: Float32Array,
        indices: Uint32Array,
    ) -> Result<Self, JsValue> {
        packed
            .validate(vertices.length() as usize, indices.length() as usize)
            .map_err(js_error)?;
        // Only prepare_packages output crosses this internal worker interface; GLB validation runs there.
        let PackedScene { scene, draws, .. } = packed;
        let gl: Gl = canvas
            .get_context("webgl2")?
            .ok_or_else(|| js_error("WebGL2 is unavailable"))?
            .dyn_into()?;
        let mut gpu = Resources::new(gl.clone());
        gpu.program = Some(program(&gl, VERTEX, FRAGMENT)?);
        gpu.sphere_program = Some(program(&gl, SPHERE_VERTEX, SPHERE_FRAGMENT)?);
        gpu.outline_program = Some(program(&gl, OUTLINE_VERTEX, OUTLINE_FRAGMENT)?);
        let uniforms = Uniforms::load(&gl, gpu.program.as_ref().unwrap())?;
        let sphere_uniforms = SphereUniforms::load(&gl, gpu.sphere_program.as_ref().unwrap())?;
        let outline_uniforms = OutlineUniforms::load(&gl, gpu.outline_program.as_ref().unwrap())?;
        gpu.upload(vertices, indices)?;
        gpu.framebuffer = Some(
            gl.create_framebuffer()
                .ok_or_else(|| js_error("Cannot allocate picking framebuffer"))?,
        );
        gpu.texture = Some(
            gl.create_texture()
                .ok_or_else(|| js_error("Cannot allocate picking texture"))?,
        );
        gpu.depth = Some(
            gl.create_renderbuffer()
                .ok_or_else(|| js_error("Cannot allocate picking depth buffer"))?,
        );
        gpu.outline_framebuffer = Some(
            gl.create_framebuffer()
                .ok_or_else(|| js_error("Cannot allocate outline framebuffer"))?,
        );
        gpu.outline_texture = Some(
            gl.create_texture()
                .ok_or_else(|| js_error("Cannot allocate outline texture"))?,
        );
        gpu.shadow_framebuffer = Some(
            gl.create_framebuffer()
                .ok_or_else(|| js_error("Cannot allocate shadow framebuffer"))?,
        );
        gpu.shadow_texture = Some(
            gl.create_texture()
                .ok_or_else(|| js_error("Cannot allocate shadow texture"))?,
        );
        gpu.shadow_depth = Some(
            gl.create_renderbuffer()
                .ok_or_else(|| js_error("Cannot allocate shadow depth buffer"))?,
        );
        let camera = Camera::new(scene.bounds);
        let mut reconstruction = Reconstruction::default();
        reconstruction
            .append(&scene.parts, scene.bounds, 0.0, false)
            .map_err(js_error)?;
        let mut viewer = Self {
            gpu,
            scene,
            camera,
            uniforms,
            sphere_uniforms,
            outline_uniforms,
            draws: draws
                .into_iter()
                .map(|(count, offset)| (0, count, offset))
                .collect(),
            reconstruction,
            shadow_cached: Cell::new(false),
            canvas,
        };
        viewer.resize(viewer.canvas.width().max(1), viewer.canvas.height().max(1))?;
        Ok(viewer)
    }
}
