use anatomy_renderer::{Camera, PackedScene, Reconstruction, Scene};
use js_sys::{Float32Array, Uint32Array};
use std::cell::Cell;
use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{
    HtmlCanvasElement, WebGl2RenderingContext as Gl, WebGlBuffer, WebGlFramebuffer, WebGlProgram,
    WebGlRenderbuffer, WebGlShader, WebGlTexture, WebGlUniformLocation, WebGlVertexArrayObject,
};

const VERTEX: &str = include_str!("shaders/model.vert.glsl");

const FRAGMENT: &str = include_str!("shaders/model.frag.glsl");

const SPHERE_VERTEX: &str = include_str!("shaders/sphere.vert.glsl");

const SPHERE_FRAGMENT: &str = include_str!("shaders/sphere.frag.glsl");
const OUTLINE_VERTEX: &str = include_str!("shaders/outline.vert.glsl");
const OUTLINE_FRAGMENT: &str = include_str!("shaders/outline.frag.glsl");

struct Resources {
    gl: Gl,
    program: Option<WebGlProgram>,
    sphere_program: Option<WebGlProgram>,
    outline_program: Option<WebGlProgram>,
    buffers: Vec<WebGlBuffer>,
    vaos: Vec<WebGlVertexArrayObject>,
    framebuffer: Option<WebGlFramebuffer>,
    texture: Option<WebGlTexture>,
    depth: Option<WebGlRenderbuffer>,
    outline_framebuffer: Option<WebGlFramebuffer>,
    outline_texture: Option<WebGlTexture>,
}

impl Resources {
    fn upload(&mut self, vertices: Float32Array, indices: Uint32Array) -> Result<usize, JsValue> {
        let gl = &self.gl;
        let vao = gl
            .create_vertex_array()
            .ok_or_else(|| js_error("Cannot allocate vertex array"))?;
        self.vaos.push(vao);
        gl.bind_vertex_array(self.vaos.last());
        for (target, data) in [
            (
                Gl::ARRAY_BUFFER,
                vertices.unchecked_into::<js_sys::Object>(),
            ),
            (
                Gl::ELEMENT_ARRAY_BUFFER,
                indices.unchecked_into::<js_sys::Object>(),
            ),
        ] {
            let buffer = gl
                .create_buffer()
                .ok_or_else(|| js_error("Cannot allocate geometry buffer"))?;
            self.buffers.push(buffer);
            gl.bind_buffer(target, self.buffers.last());
            gl.buffer_data_with_array_buffer_view(target, &data, Gl::STATIC_DRAW);
        }
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 3, Gl::FLOAT, false, 24, 0);
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 3, Gl::FLOAT, false, 24, 12);
        if gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("GPU geometry upload failed"));
        }
        Ok(self.vaos.len() - 1)
    }
}

impl Drop for Resources {
    fn drop(&mut self) {
        for b in &self.buffers {
            self.gl.delete_buffer(Some(b));
        }
        for vao in &self.vaos {
            self.gl.delete_vertex_array(Some(vao));
        }
        self.gl.delete_program(self.program.as_ref());
        self.gl.delete_program(self.sphere_program.as_ref());
        self.gl.delete_program(self.outline_program.as_ref());
        self.gl.delete_framebuffer(self.framebuffer.as_ref());
        self.gl.delete_texture(self.texture.as_ref());
        self.gl.delete_renderbuffer(self.depth.as_ref());
        self.gl
            .delete_framebuffer(self.outline_framebuffer.as_ref());
        self.gl.delete_texture(self.outline_texture.as_ref());
        if let Ok(Some(extension)) = self.gl.get_extension("WEBGL_lose_context")
            && let Ok(function) = js_sys::Reflect::get(&extension, &"loseContext".into())
            && let Some(function) = function.dyn_ref::<js_sys::Function>()
        {
            let _ = function.call0(&extension);
        }
    }
}

struct Uniforms {
    projection: WebGlUniformLocation,
    eye: WebGlUniformLocation,
    light_basis: WebGlUniformLocation,
    color: WebGlUniformLocation,
    roughness: WebGlUniformLocation,
    metallic: WebGlUniformLocation,
    specular: WebGlUniformLocation,
    subsurface: WebGlUniformLocation,
    cutoff: WebGlUniformLocation,
    selected: WebGlUniformLocation,
    picking: WebGlUniformLocation,
    pick_color: WebGlUniformLocation,
    reveal: WebGlUniformLocation,
    shadow_pass: WebGlUniformLocation,
    shadow_projection: WebGlUniformLocation,
    shadow_map: WebGlUniformLocation,
    shadow_texel: WebGlUniformLocation,
}

struct SphereUniforms {
    inverse: WebGlUniformLocation,
    origin: WebGlUniformLocation,
}

struct OutlineUniforms {
    mask: WebGlUniformLocation,
    texel: WebGlUniformLocation,
}

#[wasm_bindgen]
pub struct AnatomyViewer {
    gpu: Resources,
    scene: Scene,
    camera: Camera,
    uniforms: Uniforms,
    sphere_uniforms: SphereUniforms,
    outline_uniforms: OutlineUniforms,
    draws: Vec<(usize, i32, i32)>,
    reconstruction: Reconstruction,
    shadow_cached: Cell<bool>,
    canvas: HtmlCanvasElement,
}

#[wasm_bindgen]
impl AnatomyViewer {
    #[wasm_bindgen(constructor)]
    pub fn new(
        canvas: HtmlCanvasElement,
        bytes: &[u8],
        ids_json: &str,
    ) -> Result<AnatomyViewer, JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        let scene = Scene::from_glb(bytes, &ids).map_err(js_error)?;
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

    pub fn begin_reconstruction(&mut self, now: f64, animate: bool) -> Result<(), JsValue> {
        let mut reconstruction = Reconstruction::default();
        reconstruction
            .append(&self.scene.parts, self.scene.bounds, now, animate)
            .map_err(js_error)?;
        self.reconstruction = reconstruction;
        self.shadow_cached.set(false);
        Ok(())
    }

    #[wasm_bindgen(js_name = appendPrepared)]
    pub fn append_prepared(
        &mut self,
        prepared: js_sys::Array,
        now: f64,
        animate: bool,
    ) -> Result<(), JsValue> {
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
        self.shadow_cached.set(false);
        self.camera
            .resize(self.canvas.width(), self.canvas.height());
        Ok(())
    }

    pub fn render_reconstruction(&mut self, now: f64) -> Result<bool, JsValue> {
        let active = self.reconstruction.advance(now).map_err(js_error)?;
        self.shadow_cached.set(false);
        self.draw(false);
        Ok(active)
    }

    pub fn finish_reconstruction(&mut self) {
        self.reconstruction.finish();
        self.shadow_cached.set(false);
    }

    /// The host calls render once after batching mutations for the next frame.
    pub fn change_visibility(&mut self, ids_json: &str, shown: bool) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        self.scene
            .change_visibility(&ids, shown)
            .map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn set_visibility(&mut self, ids_json: &str) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        self.scene.set_visibility(&ids).map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(())
    }
}

impl AnatomyViewer {
    fn from_scene(canvas: HtmlCanvasElement, scene: Scene) -> Result<Self, JsValue> {
        let (packed, vertices, indices) = scene.pack().map_err(js_error)?;
        Self::from_buffers(
            canvas,
            packed,
            Float32Array::from(vertices.as_slice()),
            Uint32Array::from(indices.as_slice()),
        )
    }

    fn from_buffers(
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
        let mut gpu = Resources {
            gl: gl.clone(),
            program: None,
            sphere_program: None,
            outline_program: None,
            buffers: Vec::new(),
            vaos: Vec::new(),
            framebuffer: None,
            texture: None,
            depth: None,
            outline_framebuffer: None,
            outline_texture: None,
        };
        gpu.program = Some(program(&gl, VERTEX, FRAGMENT)?);
        gpu.sphere_program = Some(program(&gl, SPHERE_VERTEX, SPHERE_FRAGMENT)?);
        gpu.outline_program = Some(program(&gl, OUTLINE_VERTEX, OUTLINE_FRAGMENT)?);
        let p = gpu.program.as_ref().unwrap();
        let location = |name: &str| {
            gl.get_uniform_location(p, name)
                .ok_or_else(|| js_error(format!("Missing shader uniform: {name}")))
        };
        let uniforms = Uniforms {
            projection: location("view_projection")?,
            eye: location("eye")?,
            light_basis: location("light_basis")?,
            color: location("base_color")?,
            roughness: location("roughness")?,
            metallic: location("metallic")?,
            specular: location("specular")?,
            subsurface: location("subsurface")?,
            cutoff: location("alpha_cutoff")?,
            selected: location("selected")?,
            picking: location("picking")?,
            pick_color: location("pick_color")?,
            reveal: location("reveal")?,
            shadow_pass: location("shadow_pass")?,
            shadow_projection: location("shadow_projection")?,
            shadow_map: location("shadow_map")?,
            shadow_texel: location("shadow_texel")?,
        };
        let sphere_location = |name: &str| {
            gl.get_uniform_location(gpu.sphere_program.as_ref().unwrap(), name)
                .ok_or_else(|| js_error(format!("Missing sphere uniform: {name}")))
        };
        let sphere_uniforms = SphereUniforms {
            inverse: sphere_location("inverse_projection")?,
            origin: sphere_location("sphere_origin")?,
        };
        let outline_location = |name: &str| {
            gl.get_uniform_location(gpu.outline_program.as_ref().unwrap(), name)
                .ok_or_else(|| js_error(format!("Missing outline uniform: {name}")))
        };
        let outline_uniforms = OutlineUniforms {
            mask: outline_location("selection_mask")?,
            texel: outline_location("texel")?,
        };
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

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        let gl = &self.gpu.gl;
        let limit = gl
            .get_parameter(Gl::MAX_RENDERBUFFER_SIZE)?
            .as_f64()
            .unwrap_or(0.0) as u32;
        if width == 0 || height == 0 || width > limit || height > limit {
            return Err(js_error("Invalid viewport dimensions"));
        }
        self.canvas.set_width(width);
        self.shadow_cached.set(false);
        self.canvas.set_height(height);
        self.camera.resize(width, height);
        gl.bind_texture(Gl::TEXTURE_2D, self.gpu.texture.as_ref());
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MIN_FILTER, Gl::NEAREST as i32);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MAG_FILTER, Gl::NEAREST as i32);
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA8 as i32,
            width as i32,
            height as i32,
            0,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            None,
        )?;
        gl.bind_renderbuffer(Gl::RENDERBUFFER, self.gpu.depth.as_ref());
        gl.renderbuffer_storage(
            Gl::RENDERBUFFER,
            Gl::DEPTH_COMPONENT24,
            width as i32,
            height as i32,
        );
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.framebuffer.as_ref());
        gl.framebuffer_texture_2d(
            Gl::FRAMEBUFFER,
            Gl::COLOR_ATTACHMENT0,
            Gl::TEXTURE_2D,
            self.gpu.texture.as_ref(),
            0,
        );
        gl.framebuffer_renderbuffer(
            Gl::FRAMEBUFFER,
            Gl::DEPTH_ATTACHMENT,
            Gl::RENDERBUFFER,
            self.gpu.depth.as_ref(),
        );
        let complete = gl.check_framebuffer_status(Gl::FRAMEBUFFER) == Gl::FRAMEBUFFER_COMPLETE;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        if !complete || gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("Picking framebuffer allocation failed"));
        }
        gl.bind_texture(Gl::TEXTURE_2D, self.gpu.outline_texture.as_ref());
        for parameter in [Gl::TEXTURE_MIN_FILTER, Gl::TEXTURE_MAG_FILTER] {
            gl.tex_parameteri(Gl::TEXTURE_2D, parameter, Gl::LINEAR as i32);
        }
        for parameter in [Gl::TEXTURE_WRAP_S, Gl::TEXTURE_WRAP_T] {
            gl.tex_parameteri(Gl::TEXTURE_2D, parameter, Gl::CLAMP_TO_EDGE as i32);
        }
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA8 as i32,
            width as i32,
            height as i32,
            0,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            None,
        )?;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.outline_framebuffer.as_ref());
        gl.framebuffer_texture_2d(
            Gl::FRAMEBUFFER,
            Gl::COLOR_ATTACHMENT0,
            Gl::TEXTURE_2D,
            self.gpu.outline_texture.as_ref(),
            0,
        );
        let complete = gl.check_framebuffer_status(Gl::FRAMEBUFFER) == Gl::FRAMEBUFFER_COMPLETE;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.bind_texture(Gl::TEXTURE_2D, None);
        if !complete || gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("Outline framebuffer allocation failed"));
        }
        Ok(())
    }

    pub fn subset(&mut self, ids_json: &str) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        if let Some(bounds) = self.scene.subset(&ids).map_err(js_error)? {
            self.camera.fit(bounds);
        }
        self.shadow_cached.set(false);
        Ok(())
    }
    pub fn select(&mut self, id: &str) -> Result<(), JsValue> {
        self.scene.select(id).map_err(js_error)?;
        Ok(())
    }
    pub fn inspect(&mut self, action: &str) -> Result<(), JsValue> {
        if action == "reset" {
            self.camera.reset();
        } else if let Some(bounds) = self.scene.inspect(action).map_err(js_error)? {
            self.camera.fit(bounds);
        }
        self.shadow_cached.set(false);
        Ok(())
    }
    pub fn rotate(&mut self, yaw: f32, pitch: f32) -> Result<(), JsValue> {
        self.camera.rotate(yaw, pitch).map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(())
    }
    pub fn zoom(&mut self, factor: f32) -> Result<(), JsValue> {
        self.camera.zoom(factor).map_err(js_error)?;
        Ok(())
    }
    pub fn pan(&mut self, x: f32, y: f32) -> Result<(), JsValue> {
        self.camera.pan(x, y).map_err(js_error)?;
        Ok(())
    }
    pub fn visible_count(&self) -> usize {
        self.scene.visible_count()
    }
    pub fn selected_id(&self) -> String {
        self.scene.selected.clone()
    }
    pub fn pick(&mut self, x: u32, y: u32) -> Result<String, JsValue> {
        if x >= self.canvas.width() || y >= self.canvas.height() {
            return Ok(String::new());
        }
        let gl = &self.gpu.gl;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.framebuffer.as_ref());
        gl.enable(Gl::SCISSOR_TEST);
        gl.scissor(x as i32, y as i32, 1, 1);
        self.draw(true);
        let mut pixel = [0; 4];
        let result = gl.read_pixels_with_opt_u8_array(
            x as i32,
            y as i32,
            1,
            1,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            Some(&mut pixel),
        );
        gl.disable(Gl::SCISSOR_TEST);
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        let index = pixel[0] as usize | (pixel[1] as usize) << 8 | (pixel[2] as usize) << 16;
        let id = index
            .checked_sub(1)
            .and_then(|i| self.scene.parts.get(i))
            .map(|p| p.source_id.clone())
            .unwrap_or_default();
        if result.is_ok() {
            self.scene.select(&id).map_err(js_error)?;
        }
        result?;
        Ok(id)
    }

    pub fn render(&self) {
        self.draw(false);
    }
}

impl AnatomyViewer {
    fn draw_sphere(&self) {
        let gl = &self.gpu.gl;
        let u = &self.sphere_uniforms;
        let matrix = self.camera.matrix();
        gl.use_program(self.gpu.sphere_program.as_ref());
        gl.bind_vertex_array(self.gpu.vaos.first());
        gl.disable(Gl::CULL_FACE);
        gl.enable(Gl::BLEND);
        gl.blend_func_separate(
            Gl::SRC_ALPHA,
            Gl::ONE_MINUS_SRC_ALPHA,
            Gl::ONE,
            Gl::ONE_MINUS_SRC_ALPHA,
        );
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.inverse),
            false,
            &matrix.inverse().to_cols_array(),
        );
        let bounds = self.scene.bounds;
        let center = bounds.center();
        gl.uniform4f(
            Some(&u.origin),
            center.x,
            center.y,
            center.z,
            self.camera.enclosure_radius(),
        );
        // The enclosure is a backdrop; it never occludes anatomy or participates in picking.
        gl.depth_mask(false);
        gl.draw_arrays(Gl::TRIANGLES, 0, 3);
        gl.depth_mask(true);
        gl.disable(Gl::BLEND);
    }

    fn draw(&self, picking: bool) {
        let gl = &self.gpu.gl;
        if picking {
            self.shadow_cached.set(false);
        } else if !self.shadow_cached.replace(true) {
            // Picking rewrites IDs on demand; reuse its framebuffer for the key light's shadow map.
            gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.framebuffer.as_ref());
            self.draw_pass(false, true);
            gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        }
        self.draw_pass(picking, false);
        if !picking && !self.scene.selected.is_empty() {
            self.draw_outline();
        }
    }

    fn draw_outline(&self) {
        let gl = &self.gpu.gl;
        let u = &self.uniforms;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.outline_framebuffer.as_ref());
        gl.bind_texture(Gl::TEXTURE_2D, None);
        gl.disable(Gl::DEPTH_TEST);
        gl.disable(Gl::CULL_FACE);
        gl.disable(Gl::BLEND);
        gl.clear_color(0.0, 0.0, 0.0, 0.0);
        gl.clear(Gl::COLOR_BUFFER_BIT);
        gl.use_program(self.gpu.program.as_ref());
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.projection),
            false,
            &self.camera.matrix().to_cols_array(),
        );
        gl.uniform1i(Some(&u.shadow_pass), 0);
        gl.uniform1i(Some(&u.picking), 1);
        gl.uniform3f(Some(&u.pick_color), 1.0, 1.0, 1.0);
        for (i, part) in self.scene.parts.iter().enumerate() {
            if !part.visible || part.source_id != self.scene.selected {
                continue;
            }
            gl.uniform4fv_with_f32_array(Some(&u.color), &part.color);
            gl.uniform1f(Some(&u.cutoff), part.alpha_cutoff);
            gl.uniform1f(Some(&u.reveal), self.reconstruction.opacity(i));
            let (vao, count, offset) = self.draws[i];
            gl.bind_vertex_array(Some(&self.gpu.vaos[vao]));
            gl.draw_elements_with_i32(Gl::TRIANGLES, count, Gl::UNSIGNED_INT, offset);
        }
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.use_program(self.gpu.outline_program.as_ref());
        gl.bind_texture(Gl::TEXTURE_2D, self.gpu.outline_texture.as_ref());
        gl.uniform1i(Some(&self.outline_uniforms.mask), 0);
        let css_width = self.canvas.client_width();
        let ratio = if css_width > 0 {
            self.canvas.width() as f32 / css_width as f32
        } else {
            1.0
        };
        gl.uniform2f(
            Some(&self.outline_uniforms.texel),
            ratio / self.canvas.width() as f32,
            ratio / self.canvas.height() as f32,
        );
        gl.enable(Gl::BLEND);
        gl.blend_func_separate(
            Gl::SRC_ALPHA,
            Gl::ONE_MINUS_SRC_ALPHA,
            Gl::ONE,
            Gl::ONE_MINUS_SRC_ALPHA,
        );
        gl.depth_mask(false);
        gl.draw_arrays(Gl::TRIANGLES, 0, 3);
        gl.depth_mask(true);
        gl.disable(Gl::BLEND);
        gl.bind_texture(Gl::TEXTURE_2D, None);
    }

    fn draw_pass(&self, picking: bool, shadow_pass: bool) {
        let gl = &self.gpu.gl;
        let u = &self.uniforms;
        gl.viewport(
            0,
            0,
            self.canvas.width() as i32,
            self.canvas.height() as i32,
        );
        gl.depth_mask(true);
        gl.enable(Gl::DEPTH_TEST);
        gl.depth_func(Gl::LEQUAL);
        gl.disable(Gl::BLEND);
        gl.disable(Gl::DITHER);
        if shadow_pass {
            gl.clear_color(1.0, 1.0, 1.0, 1.0);
        } else {
            gl.clear_color(0.0, 0.0, 0.0, 0.0);
        }
        gl.clear(Gl::COLOR_BUFFER_BIT | Gl::DEPTH_BUFFER_BIT);
        if !picking && !shadow_pass {
            self.draw_sphere();
        }
        gl.use_program(self.gpu.program.as_ref());
        let light_basis = self.camera.light_basis();
        gl.uniform_matrix3fv_with_f32_array(
            Some(&u.light_basis),
            false,
            &light_basis.to_cols_array(),
        );
        let shadow_projection = self.scene.bounds.shadow_matrix(
            light_basis.x_axis * std::f32::consts::FRAC_1_SQRT_2
                + light_basis.y_axis * 0.5
                + light_basis.z_axis * 0.5,
        );
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.shadow_projection),
            false,
            &shadow_projection.to_cols_array(),
        );
        gl.uniform1i(Some(&u.shadow_pass), i32::from(shadow_pass));
        gl.uniform1i(Some(&u.shadow_map), 0);
        gl.uniform2f(
            Some(&u.shadow_texel),
            1.0 / self.canvas.width() as f32,
            1.0 / self.canvas.height() as f32,
        );
        gl.active_texture(Gl::TEXTURE0);
        gl.bind_texture(
            Gl::TEXTURE_2D,
            if picking || shadow_pass {
                None
            } else {
                self.gpu.texture.as_ref()
            },
        );
        gl.bind_vertex_array(self.gpu.vaos.first());
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.projection),
            false,
            &if shadow_pass {
                shadow_projection
            } else {
                self.camera.matrix()
            }
            .to_cols_array(),
        );
        let eye = self.camera.eye();
        gl.uniform3f(Some(&u.eye), eye.x, eye.y, eye.z);
        gl.uniform1i(Some(&u.picking), i32::from(picking));
        let mut order: Vec<_> = self
            .scene
            .parts
            .iter()
            .enumerate()
            .filter(|(i, p)| {
                p.visible && (!shadow_pass || !p.blend) && self.reconstruction.opacity(*i) > 0.0
            })
            .map(|(i, _)| i)
            .collect();
        if !picking && !shadow_pass {
            order.sort_by(|&a, &b| {
                let a = &self.scene.parts[a];
                let b = &self.scene.parts[b];
                a.blend.cmp(&b.blend).then_with(|| {
                    if a.blend {
                        b.bounds
                            .center()
                            .distance_squared(eye)
                            .total_cmp(&a.bounds.center().distance_squared(eye))
                    } else {
                        std::cmp::Ordering::Equal
                    }
                })
            });
        }
        let mut bound_vao = usize::MAX;
        for i in order {
            let p = &self.scene.parts[i];
            if p.double_sided {
                gl.disable(Gl::CULL_FACE);
            } else {
                gl.enable(Gl::CULL_FACE);
                gl.cull_face(Gl::BACK);
            }
            if p.blend && !picking {
                gl.enable(Gl::BLEND);
                gl.blend_func_separate(
                    Gl::SRC_ALPHA,
                    Gl::ONE_MINUS_SRC_ALPHA,
                    Gl::ONE,
                    Gl::ONE_MINUS_SRC_ALPHA,
                );
                gl.depth_mask(false);
            } else {
                gl.disable(Gl::BLEND);
                gl.depth_mask(true);
            }
            gl.uniform4fv_with_f32_array(Some(&u.color), &p.color);
            gl.uniform1f(Some(&u.roughness), p.roughness);
            gl.uniform1f(Some(&u.metallic), p.metallic);
            gl.uniform1f(Some(&u.specular), p.specular);
            gl.uniform1f(Some(&u.subsurface), p.subsurface);
            gl.uniform1f(Some(&u.cutoff), p.alpha_cutoff);
            gl.uniform1i(
                Some(&u.selected),
                i32::from(p.source_id == self.scene.selected),
            );
            let index = i + 1;
            gl.uniform3f(
                Some(&u.pick_color),
                (index & 255) as f32 / 255.0,
                ((index >> 8) & 255) as f32 / 255.0,
                ((index >> 16) & 255) as f32 / 255.0,
            );
            gl.uniform1f(Some(&u.reveal), self.reconstruction.opacity(i));
            let (vao, count, offset) = self.draws[i];
            if bound_vao != vao {
                gl.bind_vertex_array(Some(&self.gpu.vaos[vao]));
                bound_vao = vao;
            }
            gl.draw_elements_with_i32(Gl::TRIANGLES, count, Gl::UNSIGNED_INT, offset);
        }
        gl.depth_mask(true);
        gl.disable(Gl::BLEND);
    }
}

fn prepared_buffers(
    prepared: js_sys::Array,
) -> Result<(PackedScene, Float32Array, Uint32Array), JsValue> {
    if prepared.length() != 3
        || !prepared.get(0).is_instance_of::<Float32Array>()
        || !prepared.get(1).is_instance_of::<Uint32Array>()
    {
        return Err(js_error("Invalid prepared geometry buffers"));
    }
    let descriptor = prepared
        .get(2)
        .as_string()
        .ok_or_else(|| js_error("Missing scene descriptor"))?;
    let packed: PackedScene = serde_json::from_str(&descriptor).map_err(js_error)?;
    let vertices: Float32Array = prepared.get(0).unchecked_into();
    let indices: Uint32Array = prepared.get(1).unchecked_into();
    packed
        .validate(vertices.length() as usize, indices.length() as usize)
        .map_err(js_error)?;
    Ok((packed, vertices, indices))
}

fn load_packages(packages: js_sys::Array, ids_json: &str) -> Result<Scene, JsValue> {
    let ids: Vec<Vec<String>> = serde_json::from_str(ids_json).map_err(js_error)?;
    if packages.length() as usize != ids.len() {
        return Err(js_error("Package and metadata counts differ"));
    }
    let mut scenes = Vec::new();
    for (package, expected) in packages.iter().zip(ids) {
        if !package.is_instance_of::<js_sys::Uint8Array>() {
            return Err(js_error("Invalid GLB package"));
        }
        scenes.push(
            Scene::from_glb(&js_sys::Uint8Array::new(&package).to_vec(), &expected)
                .map_err(js_error)?,
        );
    }
    Scene::merge(scenes).map_err(js_error)
}

#[wasm_bindgen]
pub fn prepare_packages(packages: js_sys::Array, ids_json: &str) -> Result<js_sys::Array, JsValue> {
    let (packed, vertices, indices) = load_packages(packages, ids_json)?
        .pack()
        .map_err(js_error)?;
    let result = js_sys::Array::new();
    result.push(&Float32Array::from(vertices.as_slice()));
    result.push(&Uint32Array::from(indices.as_slice()));
    result.push(&JsValue::from_str(
        &serde_json::to_string(&packed).map_err(js_error)?,
    ));
    Ok(result)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn shader(gl: &Gl, kind: u32, source: &str) -> Result<WebGlShader, JsValue> {
    let shader = gl
        .create_shader(kind)
        .ok_or_else(|| js_error("Cannot allocate shader"))?;
    gl.shader_source(&shader, source);
    gl.compile_shader(&shader);
    if gl
        .get_shader_parameter(&shader, Gl::COMPILE_STATUS)
        .as_bool()
        != Some(true)
    {
        let log = gl.get_shader_info_log(&shader).unwrap_or_default();
        gl.delete_shader(Some(&shader));
        return Err(js_error(log));
    }
    Ok(shader)
}

fn program(gl: &Gl, vertex_source: &str, fragment_source: &str) -> Result<WebGlProgram, JsValue> {
    let vertex = shader(gl, Gl::VERTEX_SHADER, vertex_source)?;
    let fragment = match shader(gl, Gl::FRAGMENT_SHADER, fragment_source) {
        Ok(s) => s,
        Err(e) => {
            gl.delete_shader(Some(&vertex));
            return Err(e);
        }
    };
    let Some(program) = gl.create_program() else {
        gl.delete_shader(Some(&vertex));
        gl.delete_shader(Some(&fragment));
        return Err(js_error("Cannot allocate shader program"));
    };
    gl.attach_shader(&program, &vertex);
    gl.attach_shader(&program, &fragment);
    gl.link_program(&program);
    gl.delete_shader(Some(&vertex));
    gl.delete_shader(Some(&fragment));
    if gl
        .get_program_parameter(&program, Gl::LINK_STATUS)
        .as_bool()
        != Some(true)
    {
        let log = gl.get_program_info_log(&program).unwrap_or_default();
        gl.delete_program(Some(&program));
        return Err(js_error(log));
    }
    Ok(program)
}
