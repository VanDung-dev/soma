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

fn text_files(files: lessons::Files) -> Result<Vec<(String, String)>, JsValue> {
    files
        .into_iter()
        .map(|(path, bytes)| {
            String::from_utf8(bytes)
                .map(|text| (path, text))
                .map_err(js_error)
        })
        .collect()
}

#[wasm_bindgen]
pub fn prepare_browser_lesson_draft(
    data: &str,
    previous: Option<String>,
    images: JsValue,
) -> Result<JsValue, JsValue> {
    let lesson = lesson::parse(data, true).map_err(js_error)?;
    let previous = previous
        .as_deref()
        .map(|data| lesson::parse(data, true))
        .transpose()
        .map_err(js_error)?;
    let image_paths = lesson::image_paths(&lesson);
    let images: Vec<(String, usize)> = read(images)?;
    let image_bytes = images
        .iter()
        .filter(|(path, _)| image_paths.contains(path))
        .try_fold(0usize, |total, (_, bytes)| total.checked_add(*bytes))
        .ok_or_else(|| js_error("Lesson resources exceed 60 MiB"))?;
    let lessons::DraftFiles {
        metadata,
        tables,
        retained,
        mut content,
    } = lessons::prepare_draft(lesson, previous, image_bytes).map_err(js_error)?;
    let paths: Vec<_> = content.keys().chain(tables.keys()).cloned().collect();
    let mut compacted = lessons::Files::new();
    content.extend(retained);
    for (path, table) in tables {
        if let Some(existing) = content.get_mut(&path) {
            existing.extend_from_slice(&table);
            compacted.insert(path, table);
        } else {
            content.insert(path, table);
        }
    }
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct BrowserDraft {
        metadata: String,
        contents: Vec<(String, String)>,
        compacted: Vec<(String, String)>,
        paths: Vec<String>,
        image_paths: std::collections::BTreeSet<String>,
    }
    value(&BrowserDraft {
        metadata,
        contents: text_files(content)?,
        compacted: text_files(compacted)?,
        paths,
        image_paths,
    })
}

#[wasm_bindgen]
pub fn lesson_draft_matches(
    current: Option<String>,
    expected: Option<String>,
) -> Result<bool, JsValue> {
    lesson::draft::same_draft(current.as_deref(), expected.as_deref()).map_err(js_error)
}

#[wasm_bindgen]
pub fn next_lesson_revision(
    version: JsValue,
    previous: JsValue,
    now: JsValue,
) -> Result<JsValue, JsValue> {
    let previous: Option<lesson::draft::DraftRevision> = read(previous)?;
    value(&lesson::draft::next_revision(
        read(version)?,
        previous,
        read(now)?,
    ))
}

#[wasm_bindgen]
pub fn lesson_draft_paths(data: &str) -> Result<Vec<String>, JsValue> {
    let lesson = json(data)?;
    Ok(lessons::lesson_content_paths(&lesson)
        .into_iter()
        .chain(lessons::lesson_table_paths(&lesson).map(str::to_owned))
        .collect())
}

#[wasm_bindgen]
pub fn restore_lesson_draft(data: &str, files: JsValue) -> Result<String, JsValue> {
    let mut lesson = json(data)?;
    let records: Vec<(String, String)> = read(files)?;
    let (contents, tables) = records
        .into_iter()
        .map(|(path, text)| (path, text.into_bytes()))
        .partition(|(path, _)| lessons::is_content_path(path));
    lessons::hydrate_lesson_content_recovering(&mut lesson, contents);
    lessons::hydrate_lesson_tables(&mut lesson, tables).map_err(js_error)?;
    serde_json::to_string(&lesson).map_err(js_error)
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
pub fn initialize_lesson_progress(
    stored: Option<String>,
    preview: bool,
    initial_step_id: Option<String>,
) -> Result<String, JsValue> {
    let progress = lesson::progress::Progress::from_storage(stored.as_deref());
    let progress = if preview {
        progress.preview(initial_step_id)
    } else {
        progress
    };
    serde_json::to_string(&progress).map_err(js_error)
}

#[wasm_bindgen]
pub fn update_lesson_progress(
    current: &str,
    stored: Option<String>,
    action: JsValue,
) -> Result<Option<String>, JsValue> {
    let current = lesson::progress::Progress::from_storage(Some(current));
    let stored = stored
        .as_deref()
        .map(|data| lesson::progress::Progress::from_storage(Some(data)));
    current
        .update(stored, read(action)?)
        .map(|progress| serde_json::to_string(&progress).map_err(js_error))
        .transpose()
}

#[wasm_bindgen]
pub fn lesson_playback(
    current: &str,
    steps: JsValue,
    issues: JsValue,
    preview: bool,
) -> Result<JsValue, JsValue> {
    let current = lesson::progress::Progress::from_storage(Some(current));
    let steps: Vec<lesson::progress::Step> = read(steps)?;
    let issues = read(issues)?;
    value(&current.playback(&steps, &issues, preview))
}

#[wasm_bindgen]
pub fn lesson_scene_index(data: &str, index: usize) -> Result<i32, JsValue> {
    Ok(lesson::scene_index(&json(data)?, index).map_or(-1, |index| index as i32))
}

#[wasm_bindgen]
pub fn lesson_scene_fields(scene: JsValue, model_ids: Vec<String>) -> Result<JsValue, JsValue> {
    let scene: Option<Value> = read(scene)?;
    value(&lesson::editing::scene_fields(
        &scene.unwrap_or_default(),
        model_ids,
    ))
}

#[wasm_bindgen]
pub fn lesson_scene_snapshot_fields(previous: &str, requested: &str) -> Result<JsValue, JsValue> {
    value(&lesson::editing::scene_snapshot_fields(
        &json(previous)?,
        &json(requested)?,
    ))
}

#[wasm_bindgen]
pub fn lesson_remove_choice(question: JsValue, choice_id: &str) -> Result<JsValue, JsValue> {
    value(&lesson::editing::remove_choice(read(question)?, choice_id).map_err(js_error)?)
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
pub fn lesson_image_aliases(existing: JsValue, incoming: JsValue) -> Result<JsValue, JsValue> {
    #[derive(serde::Deserialize)]
    struct ImageEntry(
        String,
        #[serde(with = "serde_wasm_bindgen::preserve")] js_sys::Uint8Array,
    );

    let existing: Vec<ImageEntry> = read(existing)?;
    let incoming: Vec<ImageEntry> = read(incoming)?;
    let into_bytes = |ImageEntry(path, bytes): ImageEntry| (path, bytes.to_vec());
    value(
        &lessons::image_aliases(
            existing.into_iter().map(into_bytes),
            incoming.into_iter().map(into_bytes),
        )
        .map_err(js_error)?,
    )
}

#[wasm_bindgen]
pub fn imported_lesson_image_additions(
    data: &str,
    existing: JsValue,
    incoming: JsValue,
) -> Result<Vec<String>, JsValue> {
    let existing: Vec<(String, usize)> = read(existing)?;
    let incoming: Vec<(String, usize)> = read(incoming)?;
    lessons::imported_image_additions(
        &json(data)?,
        existing.into_iter().collect(),
        incoming.into_iter().collect(),
    )
    .map_err(js_error)
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
    pub fn preload_model_ids(&self) -> Option<Vec<String>> {
        self.data.preload_model_ids.clone()
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
    pub fn export(&self, model_ids: Option<Vec<String>>) -> Result<Vec<u8>, JsValue> {
        self.data.export_with_models(model_ids).map_err(js_error)
    }
    pub fn file_name(&self, language: &str) -> String {
        lesson::filename(&self.data.lesson, language)
    }
}
