use anatomy_renderer::{Camera, Explosion};
use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext as Gl};

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

    pub fn begin_reconstruction(&mut self, now: f64, animate: bool) -> Result<(), JsValue> {
        let mut reconstruction = anatomy_renderer::Reconstruction::default();
        reconstruction
            .append(&self.scene.parts, self.scene.bounds, now, animate)
            .map_err(js_error)?;
        self.reconstruction = reconstruction;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn start_reconstruction(&mut self, now: f64, animate: bool) -> Result<(), JsValue> {
        self.reconstruction.rebase(now).map_err(js_error)?;
        if !animate {
            self.reconstruction.finish();
        }
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

    pub fn render_reconstruction(&mut self, now: f64) -> Result<bool, JsValue> {
        let active = self.advance_reconstruction(now)?;
        self.draw(false);
        Ok(active)
    }

    pub fn advance_reconstruction(&mut self, now: f64) -> Result<bool, JsValue> {
        let hiding = (0..self.scene.parts.len()).any(|i| self.reconstruction.fading_out(i));
        let active = self.reconstruction.advance(now).map_err(js_error)?;
        if hiding && !active && self.exploding {
            let before = self.camera.clone();
            self.relayout_explosion()?;
            self.transition_camera(before, Some(now));
        }
        self.shadow_cached.set(false);
        Ok(active)
    }

    pub fn finish_reconstruction(&mut self) -> Result<(), JsValue> {
        self.reconstruction.finish();
        self.relayout_explosion()?;
        self.shadow_cached.set(false);
        Ok(())
    }

    /// The host calls render once after batching mutations for the next frame.
    pub fn change_visibility(
        &mut self,
        ids_json: &str,
        shown: bool,
        now: Option<f64>,
    ) -> Result<(), JsValue> {
        if let Some(now) = now {
            self.reconstruction.check_time(now).map_err(js_error)?;
        }
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        self.scene
            .change_visibility(&ids, shown)
            .map_err(js_error)?;
        self.reconstruction
            .set_visibility(&self.scene.parts, now)
            .map_err(js_error)?;
        self.relayout_explosion()?;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn set_visibility(&mut self, ids_json: &str) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        self.scene.set_visibility(&ids).map_err(js_error)?;
        self.reconstruction
            .set_visibility(&self.scene.parts, None)
            .map_err(js_error)?;
        self.relayout_explosion()?;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        self.resize_render_targets(width, height, self.shadow_quality)?;
        self.cancel_camera_transition();
        self.camera.aspect = width as f32 / height as f32;
        self.relayout_explosion()?;
        self.center_camera()?;
        Ok(())
    }

    pub fn set_graphics(
        &mut self,
        shadow_quality: u32,
        lighting_quality: u32,
        show_grid: bool,
        width: u32,
        height: u32,
    ) -> Result<(), JsValue> {
        if shadow_quality > 2 || lighting_quality > 2 {
            return Err(js_error("Invalid graphics quality"));
        }
        if shadow_quality != self.shadow_quality
            || width != self.canvas.width()
            || height != self.canvas.height()
        {
            self.resize_render_targets(width, height, shadow_quality)?;
        }
        self.shadow_quality = shadow_quality;
        self.lighting_quality = lighting_quality;
        self.show_grid = show_grid;
        Ok(())
    }
}

impl AnatomyViewer {
    fn resize_render_targets(
        &mut self,
        width: u32,
        height: u32,
        quality: u32,
    ) -> Result<(), JsValue> {
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
        gl.framebuffer_renderbuffer(
            Gl::FRAMEBUFFER,
            Gl::DEPTH_ATTACHMENT,
            Gl::RENDERBUFFER,
            self.gpu.depth.as_ref(),
        );
        let complete = gl.check_framebuffer_status(Gl::FRAMEBUFFER) == Gl::FRAMEBUFFER_COMPLETE;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.bind_texture(Gl::TEXTURE_2D, None);
        if !complete || gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("Outline framebuffer allocation failed"));
        }
        // Dedicated shadow map: square, decoupled from canvas size so light-space
        // texels stay small even when the viewport is small. Packed RGB depth must
        // be sampled with NEAREST, so resolution (not filtering) carries quality.
        let shadow_size = match quality {
            0 => 1,
            1 => 1024,
            _ => 2048,
        }
        .min(limit);
        gl.bind_texture(Gl::TEXTURE_2D, self.gpu.shadow_texture.as_ref());
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MIN_FILTER, Gl::NEAREST as i32);
        gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MAG_FILTER, Gl::NEAREST as i32);
        for parameter in [Gl::TEXTURE_WRAP_S, Gl::TEXTURE_WRAP_T] {
            gl.tex_parameteri(Gl::TEXTURE_2D, parameter, Gl::CLAMP_TO_EDGE as i32);
        }
        gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA8 as i32,
            shadow_size as i32,
            shadow_size as i32,
            0,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            None,
        )?;
        gl.bind_renderbuffer(Gl::RENDERBUFFER, self.gpu.shadow_depth.as_ref());
        gl.renderbuffer_storage(
            Gl::RENDERBUFFER,
            Gl::DEPTH_COMPONENT24,
            shadow_size as i32,
            shadow_size as i32,
        );
        gl.bind_framebuffer(Gl::FRAMEBUFFER, self.gpu.shadow_framebuffer.as_ref());
        gl.framebuffer_texture_2d(
            Gl::FRAMEBUFFER,
            Gl::COLOR_ATTACHMENT0,
            Gl::TEXTURE_2D,
            self.gpu.shadow_texture.as_ref(),
            0,
        );
        gl.framebuffer_renderbuffer(
            Gl::FRAMEBUFFER,
            Gl::DEPTH_ATTACHMENT,
            Gl::RENDERBUFFER,
            self.gpu.shadow_depth.as_ref(),
        );
        let complete = gl.check_framebuffer_status(Gl::FRAMEBUFFER) == Gl::FRAMEBUFFER_COMPLETE;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.bind_texture(Gl::TEXTURE_2D, None);
        if !complete || gl.get_error() != Gl::NO_ERROR {
            return Err(js_error("Shadow framebuffer allocation failed"));
        }
        self.gpu.shadow_size = shadow_size;
        Ok(())
    }
}

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn subset(&mut self, ids_json: &str) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        let bounds = self.scene.subset(&ids).map_err(js_error)?;
        self.reconstruction
            .set_visibility(&self.scene.parts, None)
            .map_err(js_error)?;
        if let Some(bounds) = bounds {
            self.cancel_camera_transition();
            self.explosion_camera = None;
            self.relayout_explosion()?;
            self.explosion.finish();
            self.camera
                .fit(self.display_bounds(&ids)?.unwrap_or(bounds));
        }
        self.center_camera()?;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn select(&mut self, id: &str) -> Result<(), JsValue> {
        self.scene.select(id).map_err(js_error)?;
        Ok(())
    }

    pub fn focus(
        &mut self,
        ids_json: &str,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
    ) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        self.scene.bounds_for(&ids).map_err(js_error)?;
        Camera::layout(
            self.scene.bounds,
            self.camera.aspect,
            [left, top, width, height],
        )
        .map_err(js_error)?;
        self.scene.change_visibility(&ids, true).map_err(js_error)?;
        self.reconstruction
            .set_visibility(&self.scene.parts, None)
            .map_err(js_error)?;
        self.cancel_camera_transition();
        self.explosion_camera = None;
        self.relayout_explosion()?;
        self.explosion.finish();
        if let Some(bounds) = self.display_bounds(&ids)? {
            self.camera
                .focus(bounds, [left, top, width, height])
                .map_err(js_error)?;
            self.shadow_cached.set(false);
        }
        self.center_camera()?;
        Ok(())
    }

    pub fn reframe(&mut self, left: f32, top: f32, width: f32, height: f32) -> Result<(), JsValue> {
        self.cancel_camera_transition();
        if self.exploding {
            let frame = [left, top, width, height];
            Camera::layout(self.scene.bounds, self.camera.aspect, frame).map_err(js_error)?;
            self.layout_frame = frame;
            self.relayout_explosion()?;
            return Ok(());
        }
        self.camera
            .reframe([left, top, width, height])
            .map_err(js_error)?;
        self.center_camera()?;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn inspect(&mut self, action: &str, now: Option<f64>) -> Result<(), JsValue> {
        if now.is_some_and(|time| !time.is_finite() || time < 0.0) {
            return Err(js_error("Invalid camera transition timestamp"));
        }
        let before = self.camera.clone();
        self.cancel_camera_transition();
        self.explosion_camera = None;
        if action == "reset" {
            if self.exploding && self.explosion.amount() > 0.0 {
                let aspect = self.camera.aspect * self.layout_frame[2] / self.layout_frame[3];
                self.explosion
                    .layout_revealed(&self.scene, aspect, &self.reconstruction);
                self.explosion.finish();
                self.camera = self
                    .explosion
                    .overview_camera_revealed(
                        &self.scene,
                        self.camera.aspect,
                        self.layout_frame,
                        &self.reconstruction,
                    )
                    .map_err(js_error)?;
            } else {
                self.explosion.finish();
                self.camera = Camera::new(self.scene.bounds);
                self.camera
                    .resize(self.canvas.width(), self.canvas.height());
            }
        } else {
            let bounds = self.scene.inspect(action).map_err(js_error)?;
            self.reconstruction
                .set_visibility(&self.scene.parts, None)
                .map_err(js_error)?;
            if let Some(bounds) = bounds {
                self.relayout_explosion()?;
                self.explosion.finish();
                let ids: std::collections::HashSet<_> = if action == "all" {
                    self.scene
                        .parts
                        .iter()
                        .filter(|p| p.visible)
                        .map(|p| p.source_id.clone())
                        .collect()
                } else {
                    [self.scene.selected.clone()].into_iter().collect()
                };
                self.camera.fit(
                    self.display_bounds(&ids.into_iter().collect::<Vec<_>>())?
                        .unwrap_or(bounds),
                );
            }
        }
        self.center_camera()?;
        self.transition_camera(before, now);
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn rotate(&mut self, yaw: f32, pitch: f32) -> Result<(), JsValue> {
        self.cancel_camera_transition();
        self.stop_explosion_follow();
        let pivot = self.orbit_bounds()?.center();
        self.camera
            .rotate_around(pivot, yaw, pitch)
            .map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn center(&mut self, x: f32, y: f32, now: Option<f64>) -> Result<(), JsValue> {
        if !x.is_finite()
            || !y.is_finite()
            || !(0.0..=1.0).contains(&x)
            || !(0.0..=1.0).contains(&y)
            || now.is_some_and(|time| !time.is_finite() || time < 0.0)
        {
            return Err(js_error("Invalid model viewport center"));
        }
        if self.uncentered_camera.is_none() {
            self.uncentered_camera = Some(self.camera.clone());
        }
        let before = self.camera.clone();
        self.view_center = Some([x, y]);
        self.center_camera()?;
        self.transition_camera(before, now);
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn clear_center(&mut self, now: Option<f64>) -> Result<(), JsValue> {
        if now.is_some_and(|time| !time.is_finite() || time < 0.0) {
            return Err(js_error("Invalid camera transition timestamp"));
        }
        if self.view_center.is_none() {
            return Ok(());
        }
        self.view_center = None;
        if let Some(mut camera) = self.uncentered_camera.clone() {
            camera.aspect = self.camera.aspect;
            let before = std::mem::replace(&mut self.camera, camera);
            self.transition_camera(before, now);
            self.shadow_cached.set(false);
        }
        Ok(())
    }

    pub fn advance_camera(&mut self, now: f64) -> Result<bool, JsValue> {
        if !now.is_finite() || now < 0.0 {
            return Err(js_error("Invalid camera transition timestamp"));
        }
        let Some((goal, previous)) = self.camera_transition.as_mut() else {
            return Ok(false);
        };
        if now < *previous {
            return Err(js_error("Camera transition timestamps must increase"));
        }
        let dt = ((now - *previous) / 1000.0).min(0.05) as f32;
        *previous = now;
        let moving = self.camera.approach(goal, 1.0 - (-26.0 * dt).exp());
        self.shadow_cached.set(false);
        if !moving {
            self.finish_camera_transition();
        }
        Ok(moving)
    }

    pub fn finish_camera_transition(&mut self) {
        if let Some((goal, _)) = self.camera_transition.take() {
            self.camera = goal;
            self.shadow_cached.set(false);
        }
        if self.view_center.is_none() {
            self.uncentered_camera = None;
        }
    }

    pub fn zoom(&mut self, factor: f32) -> Result<(), JsValue> {
        self.zoom_at(0.5, 0.5, factor)
    }

    pub fn zoom_at(&mut self, x: f32, y: f32, factor: f32) -> Result<(), JsValue> {
        self.cancel_camera_transition();
        self.stop_explosion_follow();
        self.camera
            .zoom_at(2.0 * x - 1.0, 1.0 - 2.0 * y, factor)
            .map_err(js_error)?;
        // The shadow frustum fits the viewed region, so zooming refits it.
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn pan(&mut self, x: f32, y: f32) -> Result<(), JsValue> {
        self.cancel_camera_transition();
        self.stop_explosion_follow();
        self.camera.pan(x, y).map_err(js_error)?;
        // Panning moves the fitted shadow volume with the orbit target.
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn visible_count(&self) -> usize {
        self.scene.visible_count()
    }

    pub fn selected_id(&self) -> String {
        self.scene.selected.clone()
    }

    pub fn structure_offset(&self, id: &str) -> Vec<f32> {
        self.separation.offset(id).to_array().to_vec()
    }

    pub fn structure_group(&self, id: &str) -> Vec<String> {
        self.separation.members(id)
    }

    pub fn separated_ids(&self) -> Vec<String> {
        self.separation.separated_ids()
    }

    pub fn detach_structure(&mut self, id: &str) -> Result<(), JsValue> {
        if !self
            .scene
            .parts
            .iter()
            .any(|part| part.active && part.visible && part.source_id == id)
        {
            return Err(js_error("Unknown or hidden structure"));
        }
        self.separation.detach(id);
        self.connection_target.clear();
        Ok(())
    }

    pub fn preview_connection(&mut self, id: &str) -> String {
        self.connection_target = if self.exploding || id.is_empty() {
            String::new()
        } else {
            self.separation
                .candidate(&self.scene, id, self.connection_tolerance(id))
                .unwrap_or_default()
        };
        self.connection_target.clone()
    }

    pub fn connect_structure(&mut self, id: &str) -> Result<String, JsValue> {
        let target = std::mem::take(&mut self.connection_target);
        let tolerance = self.connection_tolerance(id);
        if self.exploding
            || target.is_empty()
            || self
                .separation
                .candidate(&self.scene, id, tolerance)
                .as_deref()
                != Some(&target)
        {
            return Ok(String::new());
        }
        self.separation
            .snap(&self.scene, id, &target, tolerance)
            .map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(target)
    }

    pub fn move_structure(&mut self, id: &str, x: f32, y: f32) -> Result<(), JsValue> {
        if self.exploding {
            return Err(js_error(
                "Return explosion to zero before moving a structure",
            ));
        }
        self.cancel_camera_transition();
        self.separation
            .drag(&self.scene, &self.camera, id, x, y)
            .map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn restore_structure(&mut self, id: &str, offset: Option<Vec<f32>>) -> Result<(), JsValue> {
        self.connection_target.clear();
        if let Some(offset) = offset {
            let offset: [f32; 3] = offset
                .try_into()
                .map_err(|_| js_error("Invalid structure position"))?;
            self.separation
                .set(&self.scene, id, offset)
                .map_err(js_error)?;
        } else {
            self.separation.clear(id);
        }
        self.shadow_cached.set(false);
        Ok(())
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
    fn connection_tolerance(&self, id: &str) -> f32 {
        let Ok(Some(bounds)) = self.scene.bounds_for(&[id.into()]) else {
            return 0.0;
        };
        let matrix = self.camera.matrix();
        let point = matrix * (bounds.center() + self.separation.offset(id)).extend(1.0);
        if point.w <= 1e-6 {
            return 0.0;
        }
        let screen = point.truncate() / point.w;
        let inverse = matrix.inverse();
        let mut cursor = screen;
        cursor.x += 28.0 / self.canvas.client_width().max(1) as f32;
        let pixels = inverse
            .project_point3(cursor)
            .distance(inverse.project_point3(screen));
        pixels
            .min(bounds.radius() * 0.3)
            .min(self.scene.bounds.radius() * 0.025)
    }

    pub(crate) fn part_offset(&self, index: usize) -> [f32; 3] {
        (self.explosion.offset(index) + self.separation.offset(&self.scene.parts[index].source_id))
            .to_array()
    }
    pub(super) fn transition_camera(&mut self, before: Camera, now: Option<f64>) {
        if let Some(now) = now {
            let goal = std::mem::replace(&mut self.camera, before);
            self.camera_transition = Some((goal, now));
        } else {
            self.camera_transition = None;
            if self.view_center.is_none() {
                self.uncentered_camera = None;
            }
        }
    }
    pub(super) fn cancel_camera_transition(&mut self) {
        self.camera_transition = None;
        if self.view_center.is_none() {
            self.uncentered_camera = None;
        }
    }
    fn center_camera(&mut self) -> Result<(), JsValue> {
        if let Some([x, y]) = self.view_center {
            let pivot = self.orbit_bounds()?.center();
            self.camera
                .center_on(pivot, 2.0 * x - 1.0, 1.0 - 2.0 * y)
                .map_err(js_error)?;
        }
        Ok(())
    }
    fn orbit_bounds(&self) -> Result<anatomy_renderer::Bounds, JsValue> {
        let ids: std::collections::HashSet<_> = self
            .scene
            .parts
            .iter()
            .filter(|p| {
                p.active
                    && (self.scene.selected.is_empty()
                        || (p.visible && p.source_id == self.scene.selected))
            })
            .map(|p| p.source_id.clone())
            .collect();
        Ok(self
            .display_bounds(&ids.into_iter().collect::<Vec<_>>())?
            .unwrap_or(self.scene.bounds))
    }
}
