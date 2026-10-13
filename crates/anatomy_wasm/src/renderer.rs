use anatomy_renderer::{Camera, Scene};
use js_sys::{Float32Array, Uint32Array};
use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{
    HtmlCanvasElement, WebGl2RenderingContext as Gl, WebGlBuffer, WebGlFramebuffer, WebGlProgram,
    WebGlRenderbuffer, WebGlShader, WebGlTexture, WebGlUniformLocation, WebGlVertexArrayObject,
};

const VERTEX: &str = include_str!("shaders/model.vert.glsl");

const FRAGMENT: &str = include_str!("shaders/model.frag.glsl");

const SPHERE_VERTEX: &str = include_str!("shaders/sphere.vert.glsl");

const SPHERE_FRAGMENT: &str = include_str!("shaders/sphere.frag.glsl");

struct Resources {
    gl: Gl,
    program: Option<WebGlProgram>,
    sphere_program: Option<WebGlProgram>,
    buffers: Vec<WebGlBuffer>,
    vao: Option<WebGlVertexArrayObject>,
    framebuffer: Option<WebGlFramebuffer>,
    texture: Option<WebGlTexture>,
    depth: Option<WebGlRenderbuffer>,
}

impl Drop for Resources {
    fn drop(&mut self) {
        for b in &self.buffers {
            self.gl.delete_buffer(Some(b));
        }
        self.gl.delete_vertex_array(self.vao.as_ref());
        self.gl.delete_program(self.program.as_ref());
        self.gl.delete_program(self.sphere_program.as_ref());
        self.gl.delete_framebuffer(self.framebuffer.as_ref());
        self.gl.delete_texture(self.texture.as_ref());
        self.gl.delete_renderbuffer(self.depth.as_ref());
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
    camera_target: WebGlUniformLocation,
    color: WebGlUniformLocation,
    roughness: WebGlUniformLocation,
    metallic: WebGlUniformLocation,
    cutoff: WebGlUniformLocation,
    selected: WebGlUniformLocation,
    picking: WebGlUniformLocation,
    pick_color: WebGlUniformLocation,
}

struct SphereUniforms {
    inverse: WebGlUniformLocation,
    origin: WebGlUniformLocation,
}

#[wasm_bindgen]
pub struct AnatomyViewer {
    gpu: Resources,
    scene: Scene,
    camera: Camera,
    uniforms: Uniforms,
    sphere_uniforms: SphereUniforms,
    draws: Vec<(i32, i32)>,
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
        Self::from_scene(canvas, Scene::merge(scenes).map_err(js_error)?)
    }

    pub fn set_visibility(&mut self, ids_json: &str) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        self.scene.set_visibility(&ids).map_err(js_error)?;
        self.render();
        Ok(())
    }
}

impl AnatomyViewer {
    fn from_scene(canvas: HtmlCanvasElement, scene: Scene) -> Result<Self, JsValue> {
        let gl: Gl = canvas
            .get_context("webgl2")?
            .ok_or_else(|| js_error("WebGL2 is unavailable"))?
            .dyn_into()?;
        let mut gpu = Resources {
            gl: gl.clone(),
            program: None,
            sphere_program: None,
            buffers: Vec::new(),
            vao: None,
            framebuffer: None,
            texture: None,
            depth: None,
        };
        gpu.program = Some(program(&gl, VERTEX, FRAGMENT)?);
        gpu.sphere_program = Some(program(&gl, SPHERE_VERTEX, SPHERE_FRAGMENT)?);
        let p = gpu.program.as_ref().unwrap();
        let location = |name: &str| {
            gl.get_uniform_location(p, name)
                .ok_or_else(|| js_error(format!("Missing shader uniform: {name}")))
        };
        let uniforms = Uniforms {
            projection: location("view_projection")?,
            eye: location("eye")?,
            camera_target: location("camera_target")?,
            color: location("base_color")?,
            roughness: location("roughness")?,
            metallic: location("metallic")?,
            cutoff: location("alpha_cutoff")?,
            selected: location("selected")?,
            picking: location("picking")?,
            pick_color: location("pick_color")?,
        };
        let sphere_location = |name: &str| {
            gl.get_uniform_location(gpu.sphere_program.as_ref().unwrap(), name)
                .ok_or_else(|| js_error(format!("Missing sphere uniform: {name}")))
        };
        let sphere_uniforms = SphereUniforms {
            inverse: sphere_location("inverse_projection")?,
            origin: sphere_location("sphere_origin")?,
        };
        gpu.vao = Some(
            gl.create_vertex_array()
                .ok_or_else(|| js_error("Cannot allocate vertex array"))?,
        );
        gl.bind_vertex_array(gpu.vao.as_ref());
        let mut vertices = Vec::new();
        let mut indices = Vec::new();
        let mut draws = Vec::new();
        for part in &scene.parts {
            let base = u32::try_from(vertices.len() / 6).map_err(js_error)?;
            let offset = i32::try_from(
                indices
                    .len()
                    .checked_mul(4)
                    .ok_or_else(|| js_error("Index buffer too large"))?,
            )
            .map_err(js_error)?;
            draws.push((i32::try_from(part.indices.len()).map_err(js_error)?, offset));
            vertices.extend_from_slice(&part.vertices);
            for index in &part.indices {
                indices.push(
                    index
                        .checked_add(base)
                        .ok_or_else(|| js_error("Vertex buffer too large"))?,
                );
            }
        }
        for (target, data) in [
            (
                Gl::ARRAY_BUFFER,
                Float32Array::from(vertices.as_slice()).unchecked_into::<js_sys::Object>(),
            ),
            (
                Gl::ELEMENT_ARRAY_BUFFER,
                Uint32Array::from(indices.as_slice()).unchecked_into::<js_sys::Object>(),
            ),
        ] {
            let buffer = gl
                .create_buffer()
                .ok_or_else(|| js_error("Cannot allocate geometry buffer"))?;
            gl.bind_buffer(target, Some(&buffer));
            gpu.buffers.push(buffer);
            gl.buffer_data_with_array_buffer_view(target, &data, Gl::STATIC_DRAW);
        }
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 3, Gl::FLOAT, false, 24, 0);
        gl.enable_vertex_attrib_array(1);
        gl.vertex_attrib_pointer_with_i32(1, 3, Gl::FLOAT, false, 24, 12);
        if gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("GPU geometry upload failed"));
        }
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
        let camera = Camera::new(scene.bounds);
        let mut viewer = Self {
            gpu,
            scene,
            camera,
            uniforms,
            sphere_uniforms,
            draws,
            canvas,
        };
        viewer.resize(viewer.canvas.width().max(1), viewer.canvas.height().max(1))?;
        // Geometry is GPU resident after upload; retain only bounds, material and identity on the CPU.
        for part in &mut viewer.scene.parts {
            part.vertices = Vec::new();
            part.indices = Vec::new();
        }
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
        self.render();
        Ok(())
    }

    pub fn subset(&mut self, ids_json: &str) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        if let Some(bounds) = self.scene.subset(&ids).map_err(js_error)? {
            self.camera.fit(bounds);
        }
        self.render();
        Ok(())
    }
    pub fn select(&mut self, id: &str) -> Result<(), JsValue> {
        self.scene.select(id).map_err(js_error)?;
        self.render();
        Ok(())
    }
    pub fn inspect(&mut self, action: &str) -> Result<(), JsValue> {
        if action == "reset" {
            self.camera.reset();
        } else if let Some(bounds) = self.scene.inspect(action).map_err(js_error)? {
            self.camera.fit(bounds);
        }
        self.render();
        Ok(())
    }
    pub fn rotate(&mut self, yaw: f32, pitch: f32) -> Result<(), JsValue> {
        self.camera.rotate(yaw, pitch).map_err(js_error)?;
        self.render();
        Ok(())
    }
    pub fn zoom(&mut self, factor: f32) -> Result<(), JsValue> {
        self.camera.zoom(factor).map_err(js_error)?;
        self.render();
        Ok(())
    }
    pub fn pan(&mut self, x: f32, y: f32) -> Result<(), JsValue> {
        self.camera.pan(x, y).map_err(js_error)?;
        self.render();
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
        self.render();
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
        gl.bind_vertex_array(self.gpu.vao.as_ref());
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
        gl.clear_color(0.0, 0.0, 0.0, 0.0);
        gl.clear(Gl::COLOR_BUFFER_BIT | Gl::DEPTH_BUFFER_BIT);
        if !picking {
            self.draw_sphere();
        }
        gl.use_program(self.gpu.program.as_ref());
        gl.bind_vertex_array(self.gpu.vao.as_ref());
        gl.uniform_matrix4fv_with_f32_array(
            Some(&u.projection),
            false,
            &self.camera.matrix().to_cols_array(),
        );
        let eye = self.camera.eye();
        gl.uniform3f(Some(&u.eye), eye.x, eye.y, eye.z);
        let target = self.camera.target;
        gl.uniform3f(Some(&u.camera_target), target.x, target.y, target.z);
        gl.uniform1i(Some(&u.picking), i32::from(picking));
        let mut order: Vec<_> = self
            .scene
            .parts
            .iter()
            .enumerate()
            .filter(|(_, p)| p.visible)
            .map(|(i, _)| i)
            .collect();
        if !picking {
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
            let (count, offset) = self.draws[i];
            gl.draw_elements_with_i32(Gl::TRIANGLES, count, Gl::UNSIGNED_INT, offset);
        }
        gl.depth_mask(true);
        gl.disable(Gl::BLEND);
    }
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
