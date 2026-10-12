use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
mod renderer;

#[wasm_bindgen]
pub fn get_catalog() -> Result<String, JsValue> {
    anatomy_core::catalog_json().map_err(|error| JsValue::from_str(&error.to_string()))
}
