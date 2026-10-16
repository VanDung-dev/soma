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
        self.relayout_explosion();
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn set_visibility(&mut self, ids_json: &str) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        self.scene.set_visibility(&ids).map_err(js_error)?;
        self.relayout_explosion();
        self.shadow_cached.set(false);
        Ok(())
    }

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
        if self.exploding {
            self.camera.aspect = width as f32 / height as f32;
        } else {
            self.camera.resize(width, height);
        }
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
        // Dedicated shadow map: square, decoupled from canvas size so light-space
        // texels stay small even when the viewport is small. Packed RGB depth must
        // be sampled with NEAREST, so resolution (not filtering) carries quality.
        let shadow_size = width
            .max(height)
            .saturating_mul(2)
            .clamp(1024, 2048)
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
        self.relayout_explosion();
        Ok(())
    }

    pub fn subset(&mut self, ids_json: &str) -> Result<(), JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json).map_err(js_error)?;
        if let Some(bounds) = self.scene.subset(&ids).map_err(js_error)? {
            self.relayout_explosion();
            self.explosion.finish();
            self.camera
                .fit(self.display_bounds(&ids)?.unwrap_or(bounds));
        }
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
        self.relayout_explosion();
        self.explosion.finish();
        if let Some(bounds) = self.display_bounds(&ids)? {
            self.camera
                .focus(bounds, [left, top, width, height])
                .map_err(js_error)?;
            self.shadow_cached.set(false);
        }
        Ok(())
    }

    pub fn reframe(&mut self, left: f32, top: f32, width: f32, height: f32) -> Result<(), JsValue> {
        if self.exploding {
            let frame = [left, top, width, height];
            Camera::layout(self.scene.bounds, self.camera.aspect, frame).map_err(js_error)?;
            self.layout_frame = frame;
            self.relayout_explosion();
            return Ok(());
        }
        self.camera
            .reframe([left, top, width, height])
            .map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn inspect(&mut self, action: &str) -> Result<(), JsValue> {
        if action == "reset" {
            if self.exploding {
                let aspect = self.camera.aspect * self.layout_frame[2] / self.layout_frame[3];
                let bounds = self.explosion.layout(&self.scene, aspect);
                self.explosion.finish();
                self.camera = Camera::layout(bounds, self.camera.aspect, self.layout_frame)
                    .map_err(js_error)?;
            } else {
                self.camera = Camera::new(self.scene.bounds);
                self.camera
                    .resize(self.canvas.width(), self.canvas.height());
            }
        } else if let Some(bounds) = self.scene.inspect(action).map_err(js_error)? {
            self.relayout_explosion();
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
        // The shadow frustum fits the viewed region, so zooming refits it.
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn pan(&mut self, x: f32, y: f32) -> Result<(), JsValue> {
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
