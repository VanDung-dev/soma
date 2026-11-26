use wasm_bindgen::prelude::*;

use super::{AnatomyViewer, util::js_error};

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn begin_selection_drag(&mut self) -> Result<(), JsValue> {
        let ids = self.selection_ids();
        if self.exploding || !self.can_drag_selection(&ids) {
            return Err(js_error("Selection is unavailable for movement"));
        }
        self.detach_selection(&ids);
        Ok(())
    }

    pub fn begin_study_drag(&mut self, id: &str) -> bool {
        if self.exploding || self.separation.restoring() || !self.can_drag_structure(id) {
            return false;
        }
        self.separation.begin_drag(id, None);
        self.connection_target.clear();
        true
    }

    pub fn begin_held_study_drag(&mut self, id: &str, grouped: bool) -> Result<bool, JsValue> {
        if self.separation.restoring() || !self.can_drag_structure(id) {
            return Ok(false);
        }
        let selection = grouped.then(|| self.selection_ids());
        if selection.as_ref().is_some_and(|ids| {
            !ids.iter().any(|member| member == id) || !self.can_drag_selection(ids)
        }) || !self.select_for_movement(id, false)?
        {
            return Ok(false);
        }
        if let Some(ids) = &selection {
            self.detach_selection(ids);
        } else {
            self.separation.detach(id);
        }
        self.separation.begin_drag(id, selection);
        self.connection_target.clear();
        Ok(true)
    }

    pub fn move_study_drag(&mut self, id: &str, x: f32, y: f32) -> Result<Option<String>, JsValue> {
        let Some((_, grouped)) = self
            .separation
            .active_drag()
            .filter(|(anchor, _)| *anchor == id)
        else {
            return Ok(None);
        };
        if self.exploding {
            return Err(js_error("Return explosion to zero before dragging"));
        }
        if self.scene.selected != id {
            self.select(id)?;
        }
        self.separation
            .move_drag(&self.scene, &self.camera, x, y)
            .map_err(js_error)?;
        self.cancel_camera_transition();
        self.shadow_cached.set(false);
        if grouped {
            Ok(Some(String::new()))
        } else {
            Ok(Some(self.preview_connection(id)))
        }
    }

    pub fn finish_study_drag(&mut self, dropped: bool, moving_id: &str) -> Result<bool, JsValue> {
        let anchor = self
            .separation
            .active_drag()
            .filter(|(_, grouped)| dropped && !*grouped)
            .map(|(id, _)| id.to_owned());
        self.separation.end_drag(false);
        let Some(id) = anchor else {
            self.connection_target.clear();
            return Ok(false);
        };
        let members = self.separation.members(&id);
        let connected = !self.connect_structure(&id)?.is_empty();
        Ok(connected
            && !self.separation.moved(&id)
            && members.iter().any(|member| member == moving_id))
    }

    pub fn cancel_study_drag(&mut self) {
        self.separation.end_drag(true);
        self.connection_target.clear();
        self.shadow_cached.set(false);
    }

    pub fn move_selection(&mut self, anchor: &str, x: f32, y: f32) -> Result<(), JsValue> {
        if self.exploding {
            return Err(js_error(
                "Return explosion to zero before moving a selection",
            ));
        }
        self.separation
            .drag_selection(
                &self.scene,
                &self.camera,
                &self.selection_ids(),
                anchor,
                x,
                y,
            )
            .map_err(js_error)?;
        self.cancel_camera_transition();
        self.shadow_cached.set(false);
        Ok(())
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
        if !self.can_drag_structure(id) {
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

    pub fn begin_study_restoration(
        &mut self,
        id: &str,
        now: f64,
        animate: bool,
        moving_id: &str,
    ) -> Result<Option<bool>, JsValue> {
        let (_, outcome) = self
            .separation
            .begin_restore_for(&self.scene, id, now, animate, moving_id)
            .map_err(js_error)?;
        self.clear_selection();
        self.connection_target.clear();
        self.shadow_cached.set(false);
        Ok(outcome)
    }

    pub fn advance_study_restoration(
        &mut self,
        now: f64,
        moving_id: &str,
    ) -> Result<Option<bool>, JsValue> {
        let outcome = self
            .separation
            .advance_restore_for(now, moving_id)
            .map_err(js_error)?;
        self.shadow_cached.set(false);
        Ok(outcome)
    }

    pub fn finish_study_restoration(&mut self, moving_id: &str) -> bool {
        let outcome = self.separation.finish_restore_for(moving_id);
        self.shadow_cached.set(false);
        outcome
    }
}

impl AnatomyViewer {
    fn can_drag_structure(&self, id: &str) -> bool {
        self.scene
            .parts
            .iter()
            .any(|part| part.active && part.visible && part.source_id == id)
    }

    fn can_drag_selection(&self, ids: &[String]) -> bool {
        !ids.is_empty() && ids.iter().all(|id| self.can_drag_structure(id))
    }

    fn detach_selection(&mut self, ids: &[String]) {
        for id in ids {
            self.separation.detach(id);
        }
        self.connection_target.clear();
    }

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
