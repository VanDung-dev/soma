use ::renderer::{Bounds, Explosion};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

use super::{AnatomyViewer, util::js_error};

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn configure_explosion(&mut self, groups_json: JsValue) -> Result<(), JsValue> {
        if self.exploding {
            return Err(js_error("Leave explosion mode before configuring groups"));
        }
        let groups: Vec<Vec<String>> = super::util::read(groups_json)?;
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
        target_json: Option<JsValue>,
    ) -> Result<(), JsValue> {
        let ids: Vec<String> = target_json
            .map(super::util::read)
            .transpose()?
            .unwrap_or_default();
        self.update_explosion(amount, now, animate, overview.unwrap_or(false), ids)
    }

    pub fn finish_explosion(&mut self) -> Result<(), JsValue> {
        self.explosion.finish();
        if self.explosion_camera.is_some() {
            self.finish_camera_transition();
            self.follow_explosion()?;
            if self.explosion.amount() == 0.0 {
                self.explosion_camera = None;
            }
        }
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn render_explosion(&mut self, now: f64) -> Result<bool, JsValue> {
        let (moving, _) = self
            .explosion
            .advance(now, self.scene.bounds.radius())
            .map_err(js_error)?;
        let camera_moving = self.explosion_camera.is_some() && self.advance_camera(now)?;
        self.follow_explosion()?;
        if !moving && !camera_moving && self.explosion.amount() == 0.0 {
            self.explosion_camera = None;
        }
        self.shadow_cached.set(false);
        self.draw(false);
        Ok(moving || camera_moving)
    }
}

impl AnatomyViewer {
    pub(super) fn update_explosion(
        &mut self,
        amount: f32,
        now: f64,
        animate: bool,
        overview: bool,
        ids: Vec<String>,
    ) -> Result<(), JsValue> {
        if !self.exploding {
            return Err(js_error("Explosion mode is not enabled"));
        }
        self.scene.bounds_for(&ids).map_err(js_error)?;
        let focusing = amount == self.explosion.amount() && self.camera_transition.is_some();
        self.explosion.set(amount, now).map_err(js_error)?;
        if focusing {
            self.explosion_camera = self
                .camera_transition
                .as_ref()
                .map(|(goal, _)| goal.clone());
        } else if ids != self.explosion_target {
            self.cancel_camera_transition();
            self.explosion_camera = None;
        }
        let overview = overview && (amount > 0.0 || self.explosion_camera.is_some());
        let tracking = !ids.is_empty() && (amount > 0.0 || self.explosion_camera.is_some());
        if !focusing && (overview || tracking || self.explosion_camera.is_some()) {
            self.cancel_camera_transition();
        }
        self.explosion_target = ids;
        if overview || tracking {
            self.explosion_camera
                .get_or_insert_with(|| self.camera.clone());
        } else {
            self.explosion_camera = None;
        }
        self.relayout_explosion()?;
        if !animate {
            self.finish_explosion()?;
        }
        self.shadow_cached.set(false);
        Ok(())
    }

    pub(super) fn stop_explosion_follow(&mut self) {
        self.explosion_target.clear();
        self.explosion_camera = None;
    }

    pub(super) fn follow_explosion(&mut self) -> Result<(), JsValue> {
        let Some(original) = &self.explosion_camera else {
            return Ok(());
        };
        let ids: HashSet<_> = self.explosion_target.iter().map(String::as_str).collect();
        let parts = self.scene.parts.iter().enumerate().filter(|(_, part)| {
            part.active && part.visible && (ids.is_empty() || ids.contains(part.source_id.as_str()))
        });
        let bounds = parts
            .clone()
            .map(|(i, part)| part.bounds.translated(self.explosion.offset(i)))
            .reduce(Bounds::union);
        let Some(bounds) = bounds else {
            return Ok(());
        };
        let mut goal = original.clone();
        goal.aspect = self.camera.aspect;
        let assembled = parts
            .map(|(_, part)| part.bounds)
            .reduce(Bounds::union)
            .unwrap();
        let progress = (self.explosion.displayed_amount() / 0.3).clamp(0.0, 1.0);
        let progress = progress * progress * (3.0 - 2.0 * progress);
        if progress > 0.0 {
            let mut separated = goal.clone();
            if ids.is_empty() {
                separated = self
                    .explosion
                    .overview_camera_revealed(
                        &self.scene,
                        self.camera.aspect,
                        self.layout_frame,
                        &self.reconstruction,
                    )
                    .map_err(js_error)?;
            } else {
                separated
                    .contain(bounds, self.layout_frame, true)
                    .map_err(js_error)?;
            }
            goal.approach(&separated, progress);
        }
        goal.target += (bounds.center() - assembled.center()) * (1.0 - progress);
        if let Some((target, _)) = self.camera_transition.as_mut() {
            *target = goal;
        } else {
            self.camera = goal;
        }
        Ok(())
    }

    pub(crate) fn relayout_explosion(&mut self) -> Result<(), JsValue> {
        if !self.exploding {
            return Ok(());
        }
        let aspect = self.camera.aspect * self.layout_frame[2] / self.layout_frame[3];
        self.explosion
            .layout_revealed(&self.scene, aspect, &self.reconstruction);
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
