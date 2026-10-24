use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
mod renderer;

#[wasm_bindgen]
#[derive(Default)]
pub struct HandGestureController {
    input: anatomy_renderer::HandInput,
}

#[wasm_bindgen]
impl HandGestureController {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        self.input.reset();
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
}

#[wasm_bindgen]
pub fn get_catalog() -> Result<String, JsValue> {
    anatomy_core::catalog_json().map_err(|error| JsValue::from_str(&error.to_string()))
}
