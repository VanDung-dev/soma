use wasm_bindgen::prelude::*;

use super::{AnatomyViewer, util::js_error};

#[wasm_bindgen]
impl AnatomyViewer {
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

    pub fn begin_restoration(
        &mut self,
        id: &str,
        now: f64,
        animate: bool,
    ) -> Result<Vec<String>, JsValue> {
        let ids = self
            .separation
            .begin_restore(&self.scene, id, now, animate)
            .map_err(js_error)?;
        self.connection_target.clear();
        self.shadow_cached.set(false);
        Ok(ids)
    }

    pub fn restoration_active(&self) -> bool {
        self.separation.restoring()
    }

    pub fn advance_restoration(&mut self, now: f64) -> Result<bool, JsValue> {
        let active = self.separation.advance_restore(now).map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(active)
    }

    pub fn finish_restoration(&mut self) {
        self.separation.finish_restore();
        self.shadow_cached.set(false);
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
}
