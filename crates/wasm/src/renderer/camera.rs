use ::renderer::Camera;
use wasm_bindgen::prelude::*;

use super::{AnatomyViewer, util::js_error};

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn focus(
        &mut self,
        ids_json: JsValue,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
    ) -> Result<(), JsValue> {
        let ids: Vec<String> = super::util::read(ids_json)?;
        self.focus_ids(&ids, [left, top, width, height])
    }

    pub fn focus_animated(
        &mut self,
        ids_json: JsValue,
        left: f32,
        top: f32,
        width: f32,
        height: f32,
        now: f64,
    ) -> Result<(), JsValue> {
        if !now.is_finite() || now < 0.0 {
            return Err(js_error("Invalid focus timestamp"));
        }
        let ids: Vec<String> = super::util::read(ids_json)?;
        let before = self.camera.clone();
        self.focus_ids(&ids, [left, top, width, height])?;
        self.transition_camera(before, Some(now));
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
}

impl AnatomyViewer {
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

    fn focus_ids(&mut self, ids: &[String], frame: [f32; 4]) -> Result<(), JsValue> {
        self.scene.bounds_for(ids).map_err(js_error)?;
        Camera::layout(self.scene.bounds, self.camera.aspect, frame).map_err(js_error)?;
        self.scene.change_visibility(ids, true).map_err(js_error)?;
        self.reconstruction
            .set_visibility(&self.scene.parts, None)
            .map_err(js_error)?;
        self.cancel_camera_transition();
        self.explosion_camera = None;
        self.relayout_explosion()?;
        self.explosion.finish();
        if let Some(bounds) = self.display_bounds(ids)? {
            self.camera.focus(bounds, frame).map_err(js_error)?;
            self.shadow_cached.set(false);
        }
        self.center_camera()?;
        Ok(())
    }

    pub(super) fn center_camera(&mut self) -> Result<(), JsValue> {
        if let Some([x, y]) = self.view_center {
            let pivot = self.orbit_bounds()?.center();
            self.camera
                .center_on(pivot, 2.0 * x - 1.0, 1.0 - 2.0 * y)
                .map_err(js_error)?;
        }
        Ok(())
    }

    fn orbit_bounds(&self) -> Result<::renderer::Bounds, JsValue> {
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
