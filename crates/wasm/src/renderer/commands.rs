use ::renderer::FocusVisibility;
use serde::Serialize;
use wasm_bindgen::prelude::*;

use super::{
    AnatomyViewer,
    camera::SceneView,
    util::{js_error, read},
};

#[derive(Serialize)]
struct VisibilityUpdate {
    change: &'static str,
    ids: Vec<String>,
}

#[wasm_bindgen]
impl AnatomyViewer {
    pub fn change_study_visibility(
        &mut self,
        ids: JsValue,
        shown: bool,
        now: Option<f64>,
    ) -> Result<JsValue, JsValue> {
        let ids: Vec<String> = read(ids)?;
        self.clear_selection();
        self.change_visibility_ids(&ids, shown, now)?;
        serde_wasm_bindgen::to_value(&VisibilityUpdate {
            change: if shown { "show" } else { "hide" },
            ids,
        })
        .map_err(js_error)
    }

    pub fn focus_scene(
        &mut self,
        ids: JsValue,
        folder: bool,
        frame: JsValue,
        now: Option<f64>,
    ) -> Result<JsValue, JsValue> {
        let ids: Vec<String> = read(ids)?;
        let frame = read(frame)?;
        let focus = self
            .scene
            .focus_visibility(&ids, folder)
            .map_err(js_error)?;
        let revealed = matches!(&focus, FocusVisibility::Folder { reveal: true, .. });
        self.clear_selection();
        match &focus {
            FocusVisibility::Folder { hide, reveal } => {
                if *reveal {
                    self.change_visibility_ids(&ids, false, None)?;
                    self.change_visibility_ids(&ids, true, now)?;
                }
                self.change_visibility_ids(hide, false, now)?;
            }
            FocusVisibility::Isolate => self.set_visibility_ids(&ids)?,
            FocusVisibility::Add => {}
        }
        self.focus_with_transition(&ids, frame, now)?;
        self.select(if matches!(&focus, FocusVisibility::Isolate) {
            ids[0].as_str()
        } else {
            ""
        })?;

        #[derive(Serialize)]
        struct FocusResult {
            visibility: VisibilityUpdate,
            revealed: bool,
        }

        let change = if matches!(focus, FocusVisibility::Add) {
            "show"
        } else {
            "replace"
        };
        serde_wasm_bindgen::to_value(&FocusResult {
            visibility: VisibilityUpdate { change, ids },
            revealed,
        })
        .map_err(js_error)
    }

    pub fn apply_study_scene(
        &mut self,
        ids: JsValue,
        view: Option<JsValue>,
        frame: Option<JsValue>,
        now: Option<f64>,
    ) -> Result<JsValue, JsValue> {
        let ids: Vec<String> = read(ids)?;
        if !self.scene.has_visibility_ids(&ids) {
            return Ok(JsValue::UNDEFINED);
        }
        let view: Option<SceneView> = view.map(read).transpose()?;
        let reveal = self.background_camera.is_some() && self.visible_count() == 0;
        let fit = frame.is_some() && view.is_none() && !ids.is_empty();
        let framed = frame.is_some();
        if let Some(frame) = frame {
            let [left, top, width, height]: [f32; 4] = read(frame)?;
            self.reframe(left, top, width, height)?;
        }
        self.apply_scene_view(&ids, view, now)?;
        if fit {
            self.fit_scene_frame()?;
        } else if framed {
            self.align_viewport(None)?;
        }
        if reveal {
            self.set_visibility_ids(&[])?;
            self.change_visibility_ids(&ids, true, now)?;
        }

        #[derive(Serialize)]
        struct SceneResult {
            visibility: VisibilityUpdate,
            fit: bool,
        }

        serde_wasm_bindgen::to_value(&SceneResult {
            visibility: VisibilityUpdate {
                change: "replace",
                ids,
            },
            fit,
        })
        .map_err(js_error)
    }

    pub fn reset_study_scene(
        &mut self,
        ids: JsValue,
        now: f64,
        animate: bool,
    ) -> Result<JsValue, JsValue> {
        let ids: Vec<String> = read(ids)?;
        self.clear_selection();
        self.clear_center(None)?;
        self.select("")?;
        self.restore_structure("", None)?;
        if self.exploding {
            self.update_explosion(0.0, now, false, false, Vec::new())?;
            self.set_explode_mode(false)?;
        }
        let time = animate.then_some(now);
        self.change_visibility_ids(&ids, true, time)?;
        self.inspect("reset", time)?;
        serde_wasm_bindgen::to_value(&VisibilityUpdate {
            change: "replace",
            ids,
        })
        .map_err(js_error)
    }

    pub fn explosion_active(&self) -> bool {
        self.exploding
    }

    pub fn can_move_structures(&self) -> bool {
        !self.exploding || self.explosion.amount() == 0.0
    }

    pub fn select_for_movement(&mut self, id: &str, selected_only: bool) -> Result<bool, JsValue> {
        if !id.is_empty() {
            if selected_only
                && (self.scene.selected != id
                    || !self
                        .scene
                        .parts
                        .iter()
                        .any(|part| part.active && part.visible && part.source_id == id))
            {
                return Ok(false);
            }
            if !self.can_move_structures() {
                return Ok(false);
            }
            if self.exploding {
                self.finish_explosion()?;
                self.set_explode_mode(false)?;
            }
            self.select(id)?;
        }
        Ok(true)
    }

    pub fn set_study_explosion(
        &mut self,
        amount: f32,
        ids: JsValue,
        frame: Option<JsValue>,
        now: f64,
        animate: bool,
        moving: bool,
    ) -> Result<bool, JsValue> {
        if moving || !self.separation.is_empty() {
            return Ok(false);
        }
        self.clear_selection();
        if amount > 0.0 && !self.exploding {
            self.set_explode_mode(true)?;
            if let Some(frame) = frame {
                let [left, top, width, height]: [f32; 4] = read(frame)?;
                self.reframe(left, top, width, height)?;
            }
        }
        if self.exploding {
            let ids: Vec<String> = read(ids)?;
            self.update_explosion(amount, now, animate, ids.is_empty(), ids)?;
        }
        Ok(true)
    }

    pub fn render_study_explosion(&mut self, now: f64) -> Result<bool, JsValue> {
        let animating = self.render_explosion(now)?;
        if !animating && self.explosion.amount() == 0.0 {
            self.set_explode_mode(false)?;
        }
        Ok(animating)
    }
}
