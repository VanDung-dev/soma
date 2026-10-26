use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext as Gl;

use super::{AnatomyViewer, util::js_error};

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn begin_reconstruction(&mut self, now: f64, animate: bool) -> Result<(), JsValue> {
        let mut reconstruction = ::renderer::Reconstruction::default();
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
}
