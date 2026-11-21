use ::renderer::{Camera, PackedScene, Scene};
use js_sys::{Float32Array, Uint32Array};
use wasm_bindgen::prelude::*;

use super::util::js_error;

pub(crate) fn prepared_buffers(
    prepared: js_sys::Array,
) -> Result<(PackedScene, Float32Array, Uint32Array), JsValue> {
    if prepared.length() != 3
        || !prepared.get(0).is_instance_of::<Float32Array>()
        || !prepared.get(1).is_instance_of::<Uint32Array>()
    {
        return Err(js_error("Invalid prepared geometry buffers"));
    }
    let descriptor = prepared
        .get(2)
        .as_string()
        .ok_or_else(|| js_error("Missing scene descriptor"))?;
    let packed: PackedScene = serde_json::from_str(&descriptor).map_err(js_error)?;
    let vertices: Float32Array = prepared.get(0).unchecked_into();
    let indices: Uint32Array = prepared.get(1).unchecked_into();
    packed
        .validate(vertices.length() as usize, indices.length() as usize)
        .map_err(js_error)?;
    Ok((packed, vertices, indices))
}

pub(crate) fn load_packages(packages: js_sys::Array, ids_json: &str) -> Result<Scene, JsValue> {
    let ids: Vec<Vec<String>> = serde_json::from_str(ids_json).map_err(js_error)?;
    load_package_ids(packages, ids)
}

fn load_package_ids(packages: js_sys::Array, ids: Vec<Vec<String>>) -> Result<Scene, JsValue> {
    if packages.length() as usize != ids.len() {
        return Err(js_error("Package and metadata counts differ"));
    }
    let mut scenes = Vec::new();
    for (package, expected) in packages.iter().zip(ids) {
        let bytes = package
            .dyn_into::<js_sys::Uint8Array>()
            .map_err(|_| js_error("Invalid GLB package"))?;
        scenes.push(Scene::from_glb(&bytes.to_vec(), &expected).map_err(js_error)?);
    }
    Scene::merge(scenes).map_err(js_error)
}

#[wasm_bindgen]
pub fn prepare_packages(packages: js_sys::Array, ids_json: &str) -> Result<js_sys::Array, JsValue> {
    pack(load_packages(packages, ids_json)?, false)
}

#[wasm_bindgen]
pub fn prepare_package_ids(
    packages: js_sys::Array,
    ids: JsValue,
) -> Result<js_sys::Array, JsValue> {
    pack(
        load_package_ids(
            packages,
            serde_wasm_bindgen::from_value(ids).map_err(js_error)?,
        )?,
        false,
    )
}

#[wasm_bindgen]
pub fn prepare_model(
    bytes: js_sys::Uint8Array,
    ids: JsValue,
    selected: JsValue,
    overview: Option<bool>,
) -> Result<js_sys::Array, JsValue> {
    let expected: Vec<String> = serde_wasm_bindgen::from_value(ids).map_err(js_error)?;
    let selected: Vec<String> = serde_wasm_bindgen::from_value(selected).map_err(js_error)?;
    let mut scene = Scene::from_glb(&bytes.to_vec(), &expected).map_err(js_error)?;
    scene.subset(&selected).map_err(js_error)?;
    scene.parts.retain(|part| part.active);
    pack(
        Scene::merge(vec![scene]).map_err(js_error)?,
        overview.unwrap_or(false),
    )
}

fn pack(scene: Scene, overview: bool) -> Result<js_sys::Array, JsValue> {
    let framing = overview
        .then(|| Camera::new(scene.bounds).overview_framing(&scene.parts))
        .flatten();
    let (mut packed, vertices, indices) = scene.pack().map_err(js_error)?;
    packed.overview_framing = framing;
    let result = js_sys::Array::new();
    result.push(&Float32Array::from(vertices.as_slice()));
    result.push(&Uint32Array::from(indices.as_slice()));
    result.push(&JsValue::from_str(
        &serde_json::to_string(&packed).map_err(js_error)?,
    ));
    Ok(result)
}
