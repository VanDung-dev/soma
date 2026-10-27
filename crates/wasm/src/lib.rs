use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
mod renderer;

#[wasm_bindgen]
#[derive(Default)]
pub struct HandGestureController {
    input: ::renderer::HandInput,
    camera_allowed: Option<bool>,
    suspended: bool,
}

#[wasm_bindgen]
impl HandGestureController {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        self.input.reset();
        self.camera_allowed = None;
    }

    pub fn set_suspended(&mut self, suspended: bool) {
        if self.suspended != suspended {
            self.cancel_controls();
            self.suspended = suspended;
        }
    }

    pub fn cancel_controls(&mut self) {
        self.input.cancel_controls();
    }

    pub fn update(
        &mut self,
        hands: &[f32],
        timestamp: f64,
        aspect: f32,
        region: &[f32],
    ) -> Result<String, JsValue> {
        serde_json::to_string(
            &self
                .input
                .update_in_region(hands, timestamp, aspect, region),
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn update_controls(
        &mut self,
        hands: &[f32],
        timestamp: f64,
        aspect: f32,
        region: &[f32],
        camera_allowed: bool,
    ) -> Result<String, JsValue> {
        if self
            .camera_allowed
            .is_some_and(|before| before != camera_allowed)
        {
            self.input.cancel_controls();
        }
        self.camera_allowed = Some(camera_allowed);
        let mut feedback = self
            .input
            .update_in_region(hands, timestamp, aspect, region);
        if self.suspended || !camera_allowed {
            feedback.commands.clear();
            feedback.mode = if self.suspended { "paused" } else { "idle" };
            feedback.zoom = "none";
        }
        serde_json::to_string(&feedback).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}
