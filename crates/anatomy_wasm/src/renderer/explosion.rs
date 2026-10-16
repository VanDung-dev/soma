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
        if enabled && !self.explosion.configured() {
            return Err(js_error("Configure explosion groups first"));
        }
        if enabled == self.exploding {
            return Ok(());
        }
        self.explosion.clear();
        self.exploding = enabled;
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn set_explode(&mut self, amount: f32, now: f64, animate: bool) -> Result<(), JsValue> {
        if !self.exploding {
            return Err(js_error("Explosion mode is not enabled"));
        }
        self.explosion.set(amount, now).map_err(js_error)?;
        self.relayout_explosion();
        if !animate {
            self.finish_explosion();
        }
        self.shadow_cached.set(false);
        Ok(())
    }

    pub fn finish_explosion(&mut self) {
        self.explosion.finish();
        self.shadow_cached.set(false);
    }

    pub fn render_explosion(&mut self, now: f64) -> Result<bool, JsValue> {
        let (moving, _) = self
            .explosion
            .advance(now, self.scene.bounds.radius())
            .map_err(js_error)?;
        self.shadow_cached.set(false);
        self.draw(false);
        Ok(moving)
    }
}

impl AnatomyViewer {
    pub(crate) fn relayout_explosion(&mut self) {
        if !self.exploding {
            return;
        }
        let aspect = self.camera.aspect * self.layout_frame[2] / self.layout_frame[3];
        self.explosion.layout(&self.scene, aspect);
        self.shadow_cached.set(false);
    }

    pub(crate) fn display_bounds(&self, ids: &[String]) -> Result<Option<Bounds>, JsValue> {
        let bounds = self.scene.bounds_for(ids).map_err(js_error)?;
        if !self.exploding {
            return Ok(bounds);
        }
        let ids: HashSet<_> = ids.iter().map(String::as_str).collect();
        Ok(self
            .scene
            .parts
            .iter()
            .enumerate()
            .filter(|(_, p)| p.active && ids.contains(p.source_id.as_str()))
            .map(|(i, p)| p.bounds.translated(self.explosion.offset(i)))
            .reduce(Bounds::union))
    }
}
