use anatomy_renderer::{Bounds, Explosion};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

use super::{AnatomyViewer, util::js_error};

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn configure_explosion(&mut self, groups_json: &str) -> Result<(), JsValue> {
        if self.exploding {
            return Err(js_error("Leave explosion mode before configuring groups"));
        }
        let groups: Vec<Vec<String>> = serde_json::from_str(groups_json).map_err(js_error)?;
        self.explosion = Explosion::new(&self.scene, groups).map_err(js_error)?;
        Ok(())
    }

    pub fn set_explode_mode(&mut self, enabled: bool) -> Result<(), JsValue> {
        if enabled && !self.separation.is_empty() {
            return Err(js_error(
                "Restore moved structures before enabling explosion",
            ));
        }
        if enabled && !self.explosion.configured() {
            return Err(js_error("Configure explosion groups first"));
        }
        if enabled == self.exploding {
            return Ok(());
        }
        if let Some(mut camera) = self.explosion_camera.take() {
            self.cancel_camera_transition();
            camera.aspect = self.camera.aspect;
            self.camera = camera;
        }
        self.explosion.clear();
        self.explosion_target.clear();
        self.exploding = enabled;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn set_explode(
        &mut self,
        amount: f32,
        now: f64,
        animate: bool,
        overview: Option<bool>,
        target_json: Option<String>,
    ) -> Result<(), JsValue> {
        if !self.exploding {
            return Err(js_error("Explosion mode is not enabled"));
        }
        let ids: Vec<String> =
            serde_json::from_str(target_json.as_deref().unwrap_or("[]")).map_err(js_error)?;
        self.scene.bounds_for(&ids).map_err(js_error)?;
        self.explosion.set(amount, now).map_err(js_error)?;
        if ids != self.explosion_target {
            self.cancel_camera_transition();
            self.explosion_camera = None;
        }
        let overview =
            overview.unwrap_or(false) && (amount > 0.0 || self.explosion_camera.is_some());
        let tracking = !ids.is_empty() && (amount > 0.0 || self.explosion_camera.is_some());
        if overview || tracking || self.explosion_camera.is_some() {
            self.cancel_camera_transition();
        }
        self.explosion_target = ids;
        if overview || tracking {
            self.explosion_camera
                .get_or_insert_with(|| self.camera.clone());
        } else {
            self.explosion_camera = None;
        }
        let before = self.camera.clone();
        self.relayout_explosion()?;
        if overview || (tracking && amount == 0.0) {
            self.transition_camera(before, animate.then_some(now));
        }
        if !animate {
            self.finish_explosion()?;
        }
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn finish_explosion(&mut self) -> Result<(), JsValue> {
        self.explosion.finish();
        if self.explosion_camera.is_some() {
            self.finish_camera_transition();
            self.follow_explosion(1.0)?;
            if self.explosion.amount() == 0.0 {
                self.explosion_camera = None;
            }
        }
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn render_explosion(&mut self, now: f64) -> Result<bool, JsValue> {
        let (moving, blend) = self
            .explosion
            .advance(now, self.scene.bounds.radius())
            .map_err(js_error)?;
        let camera_moving = self.explosion_camera.is_some() && self.advance_camera(now)?;
        let tracking = self.follow_explosion(blend)?;
        if !camera_moving && self.explosion.amount() == 0.0 {
            self.explosion_camera = None;
        }
        self.shadow_cached.set(false);
        self.draw(false);
        Ok(moving || camera_moving || tracking)
    }
}

impl AnatomyViewer {
    pub(super) fn stop_explosion_follow(&mut self) {
        if !self.explosion_target.is_empty() {
            self.explosion_target.clear();
            self.explosion_camera = None;
        }
    }

    fn follow_explosion(&mut self, blend: f32) -> Result<bool, JsValue> {
        if self.explosion.amount() == 0.0 || self.explosion_target.is_empty() {
            return Ok(false);
        }
        let Some(original) = &self.explosion_camera else {
            return Ok(false);
        };
        let ids: HashSet<_> = self.explosion_target.iter().map(String::as_str).collect();
        let bounds = self
            .scene
            .parts
            .iter()
            .enumerate()
            .filter(|(_, part)| {
                part.active && part.visible && ids.contains(part.source_id.as_str())
            })
            .map(|(i, part)| part.bounds.translated(self.explosion.offset(i)))
            .reduce(Bounds::union);
        let Some(bounds) = bounds else {
            return Ok(false);
        };
        let mut goal = original.clone();
        goal.aspect = self.camera.aspect;
        goal.contain(bounds, self.layout_frame, self.explosion.amount() > 0.6)
            .map_err(js_error)?;
        Ok(self.camera.approach(&goal, blend))
    }

    pub(crate) fn relayout_explosion(&mut self) -> Result<(), JsValue> {
        if !self.exploding {
            return Ok(());
        }
        let aspect = self.camera.aspect * self.layout_frame[2] / self.layout_frame[3];
        self.explosion
            .layout_revealed(&self.scene, aspect, &self.reconstruction);
        if let Some(original) = &self.explosion_camera {
            if !self.explosion_target.is_empty() && self.explosion.amount() > 0.0 {
                self.shadow_cached.set(false);
                return Ok(());
            }
            let mut goal = if self.explosion.amount() > 0.0 {
                self.explosion
                    .overview_camera_revealed(
                        &self.scene,
                        self.camera.aspect,
                        self.layout_frame,
                        &self.reconstruction,
                    )
                    .map_err(js_error)?
            } else {
                original.clone()
            };
            goal.aspect = self.camera.aspect;
            if let Some((target, _)) = self.camera_transition.as_mut() {
                *target = goal;
            } else {
                self.camera = goal;
            }
        }
        self.shadow_cached.set(false);
        Ok(())
    }

    pub(crate) fn display_bounds(&self, ids: &[String]) -> Result<Option<Bounds>, JsValue> {
        self.scene.bounds_for(ids).map_err(js_error)?;
        let ids: HashSet<_> = ids.iter().map(String::as_str).collect();
        Ok(self
            .scene
            .parts
            .iter()
            .enumerate()
            .filter(|(_, p)| p.active && ids.contains(p.source_id.as_str()))
            .map(|(i, p)| p.bounds.translated(self.part_offset(i).into()))
            .reduce(Bounds::union))
    }
}
