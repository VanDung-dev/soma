use crate::bindings::{read, value};
use crate::lessons;
use catalog::lesson;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

fn js_error(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}
fn validation_error(error: lesson::ValidationError) -> JsValue {
    value(&error).unwrap_or_else(|cause| cause)
}
fn json(data: &str) -> Result<Value, JsValue> {
    serde_json::from_str(data).map_err(js_error)
}

#[wasm_bindgen]
pub fn validate_lesson(data: &str, draft: bool) -> Result<(), JsValue> {
    lesson::validate(&json(data)?, draft).map_err(validation_error)
}

#[wasm_bindgen]
pub fn lesson_targets(data: &str, ids: JsValue, members: JsValue) -> Result<(), JsValue> {
    let ids: Vec<String> = read(ids)?;
    let members: HashMap<String, Vec<String>> = read(members)?;
    lesson::validate_targets(&json(data)?, &ids, &members).map_err(validation_error)
}

#[wasm_bindgen]
pub fn lesson_preview_issues(
    data: &str,
    ids: JsValue,
    members: JsValue,
) -> Result<JsValue, JsValue> {
    let ids: Vec<String> = read(ids)?;
    let members: HashMap<String, Vec<String>> = read(members)?;
    value(&lesson::preview_issues(&json(data)?, &ids, &members))
}

#[wasm_bindgen]
pub fn lesson_scene_index(data: &str, index: usize) -> Result<i32, JsValue> {
    Ok(lesson::scene_index(&json(data)?, index).map_or(-1, |index| index as i32))
}

#[wasm_bindgen]
pub fn lesson_image_paths(data: &str) -> Result<JsValue, JsValue> {
    value(&lesson::image_paths(&json(data)?))
}

#[wasm_bindgen]
pub fn is_lesson_image_path(path: &str) -> bool {
    lesson::image_path(path)
}

#[wasm_bindgen]
pub fn validate_lesson_file(name: &str, size: f64) -> Result<(), JsValue> {
    lessons::check_file(name, byte_size(size)?).map_err(js_error)
}

fn byte_size(size: f64) -> Result<usize, JsValue> {
    if !size.is_finite() || size < 0. || size.fract() != 0. || size > lesson::ARCHIVE_LIMIT as f64 {
        return Err(js_error(
            "Lesson data exceeds 64 MiB or has an invalid size",
        ));
    }
    Ok(size as usize)
}

#[wasm_bindgen]
pub fn validate_lesson_image_size(size: f64) -> Result<(), JsValue> {
    lessons::check_image_size(byte_size(size)?).map_err(js_error)
}

#[wasm_bindgen]
pub fn validate_lesson_resources(data: &str, paths: JsValue) -> Result<(), JsValue> {
    let paths: HashSet<String> = read(paths)?;
    lesson::validate_resources(&json(data)?, &paths).map_err(js_error)
}

#[wasm_bindgen]
pub fn lesson_image_info(bytes: &[u8]) -> Result<JsValue, JsValue> {
    value(&lessons::image_info(bytes).map_err(js_error)?)
}

#[wasm_bindgen]
pub fn validate_lesson_images(entries: JsValue) -> Result<(), JsValue> {
    let entries: Vec<(String, usize)> = read(entries)?;
    lessons::check_image_collection(&entries).map_err(js_error)
}

#[wasm_bindgen]
pub struct LessonPackage {
    data: lessons::Package,
}

#[wasm_bindgen]
impl LessonPackage {
    #[wasm_bindgen(constructor)]
    pub fn new(data: &str) -> Result<Self, JsValue> {
        Ok(Self {
            data: lessons::Package::new(data).map_err(js_error)?,
        })
    }
    pub fn open(name: &str, bytes: &[u8]) -> Result<Self, JsValue> {
        Ok(Self {
            data: lessons::Package::open(name, bytes).map_err(js_error)?,
        })
    }
    pub fn lesson_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.data.lesson).map_err(js_error)
    }
    pub fn image_paths(&self) -> Result<JsValue, JsValue> {
        value(&self.data.images.keys().collect::<Vec<_>>())
    }
    pub fn image_bytes(&self, path: &str) -> Result<Vec<u8>, JsValue> {
        self.data
            .images
            .get(path)
            .cloned()
            .ok_or_else(|| js_error("Missing lesson image"))
    }
    pub fn image_mime(&self, path: &str) -> Result<String, JsValue> {
        Ok(match path.rsplit('.').next() {
            Some("png") => "image/png",
            Some("jpg") => "image/jpeg",
            Some("webp") => "image/webp",
            _ => return Err(js_error("Invalid lesson image")),
        }
        .into())
    }
    pub fn add_image(&mut self, path: String, bytes: &[u8]) -> Result<(), JsValue> {
        self.data.add_image(path, bytes.to_vec()).map_err(js_error)
    }
    pub fn export(&self) -> Result<Vec<u8>, JsValue> {
        self.data.export().map_err(js_error)
    }
    pub fn file_name(&self, language: &str) -> String {
        lesson::filename(&self.data.lesson, language)
    }
}
