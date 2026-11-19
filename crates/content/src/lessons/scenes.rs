use super::Files;
use catalog::lesson;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const PATH: &str = "scenes.jsonl";
const SCENE_LIMIT: usize = lesson::JSON_LIMIT;
const SCENE_COUNT_LIMIT: usize = 2048;
const FIELDS: [&str; 4] = ["modelIds", "targetId", "visibleIds", "view"];

pub(super) fn declared_models(lesson: &Value) -> Vec<String> {
    let mut models = lesson["modelIds"].as_array().cloned().unwrap_or_default();
    if models.is_empty() && lesson["modelId"].as_str().is_some_and(|id| !id.is_empty()) {
        models.push(lesson["modelId"].clone());
    }
    let scenes = lesson.get("scene").into_iter().chain(
        lesson["steps"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|step| step["kind"] != "text"),
    );
    models.extend(
        scenes
            .filter_map(|scene| scene["modelIds"].as_array())
            .flatten()
            .cloned(),
    );
    let mut seen = BTreeSet::new();
    models
        .into_iter()
        .filter_map(|id| id.as_str().map(str::to_owned))
        .filter(|id| seen.insert(id.clone()))
        .collect()
}

pub(super) fn check_models(declared: &[String], preload: &[String]) -> Result<(), String> {
    let ids: BTreeSet<_> = preload.iter().collect();
    if ids.len() != preload.len() || declared.iter().any(|id| !ids.contains(id)) {
        return Err("Invalid lesson model preload list".into());
    }
    Ok(())
}

pub fn externalize_lesson_scenes(lesson: &mut Value) -> Result<Files, String> {
    let mut files = Files::new();
    let mut write_scene = |id: String, mut scene: Map<String, Value>| -> Result<Value, String> {
        scene.insert("id".into(), Value::String(id));
        let mut bytes = serde_json::to_vec(&scene).map_err(|cause| cause.to_string())?;
        bytes.push(b'\n');
        if bytes.len() > SCENE_LIMIT || files.len() >= SCENE_COUNT_LIMIT {
            return Err("Lesson scene limit exceeded".into());
        }
        let reference = scene_reference(&bytes);
        files.insert(reference.clone(), bytes);
        Ok(Value::String(reference))
    };
    let root = lesson.as_object_mut().unwrap();
    if let Some(Value::Object(scene)) = root.remove("scene") {
        root.insert("sceneRef".into(), write_scene("setup".into(), scene)?);
    }
    for step in root.get_mut("steps").unwrap().as_array_mut().unwrap() {
        if step["kind"] == "text" {
            continue;
        }
        let id = format!("step-{}", step["id"].as_str().unwrap());
        let step = step.as_object_mut().unwrap();
        let unavailable = step.contains_key("sceneRef");
        let scene = FIELDS
            .into_iter()
            .filter_map(|field| step.remove(field).map(|value| (field.to_owned(), value)))
            .collect();
        if !unavailable {
            step.insert("sceneRef".into(), write_scene(id, scene)?);
        }
    }
    if lesson_scene_references(lesson).len() > SCENE_COUNT_LIMIT {
        return Err("Lesson scene limit exceeded".into());
    }
    Ok(files)
}

fn scene_reference(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn lesson_scene_references(lesson: &Value) -> BTreeSet<&str> {
    std::iter::once(lesson)
        .chain(lesson["steps"].as_array().into_iter().flatten())
        .filter_map(|node| {
            node["sceneRef"]
                .as_str()
                .filter(|reference| lesson::section_reference(reference))
        })
        .collect()
}

pub fn hydrate_lesson_scenes(lesson: &mut Value, files: Files) -> Vec<String> {
    let mut files: BTreeMap<_, _> = files
        .into_iter()
        .filter(|(reference, bytes)| {
            !bytes.is_empty() && bytes.len() <= SCENE_LIMIT && scene_reference(bytes) == *reference
        })
        .collect();
    let mut missing = Vec::new();
    let mut read_scene = |node: &mut Map<String, Value>, id: &str| {
        let reference = node.get("sceneRef")?.as_str()?;
        let scene = files.get(reference).and_then(|bytes| {
            let mut scene: Map<String, Value> = serde_json::from_slice(bytes).ok()?;
            if scene.remove("id")?.as_str()? != id
                || id != "setup" && scene.keys().any(|field| !FIELDS.contains(&field.as_str()))
            {
                return None;
            }
            let scene = Value::Object(scene);
            lesson::scene(&scene).then_some(scene)
        });
        if scene.is_some() {
            files.remove(reference);
            node.remove("sceneRef");
        } else {
            missing.push(reference.to_owned());
        }
        scene
    };
    if let Some(root) = lesson.as_object_mut() {
        if let Some(scene) = read_scene(root, "setup") {
            root.insert("scene".into(), scene);
        }
        if let Some(steps) = root.get_mut("steps").and_then(Value::as_array_mut) {
            for step in steps.iter_mut().filter_map(Value::as_object_mut) {
                if !step.contains_key("sceneRef") {
                    continue;
                }
                let id = format!(
                    "step-{}",
                    step.get("id").and_then(Value::as_str).unwrap_or_default()
                );
                match read_scene(step, &id) {
                    Some(Value::Object(scene)) => step.extend(scene),
                    _ => {
                        for field in FIELDS {
                            step.remove(field);
                        }
                        step.insert("targetId".into(), Value::String(String::new()));
                        step.insert("modelIds".into(), Value::Array(Vec::new()));
                    }
                }
            }
        }
        if !missing.is_empty() {
            root.remove("preloadModelIds");
        }
    }
    missing
}
