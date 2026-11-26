use crate::data::{LessonModelSelection, LessonSceneSelection};
use serde::{Serialize, de::DeserializeOwned};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

pub(crate) fn value<T: Serialize>(data: &T) -> Result<JsValue, JsValue> {
    data.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
pub(crate) fn read<T: DeserializeOwned>(data: JsValue) -> Result<T, JsValue> {
    if let Some(json) = data.as_string() {
        serde_json::from_str(&json).map_err(|e| JsValue::from_str(&e.to_string()))
    } else {
        serde_wasm_bindgen::from_value(data).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

#[wasm_bindgen]
pub struct CatalogData {
    data: crate::data::CatalogData,
}

#[wasm_bindgen]
pub struct PreparedModelMetadata {
    data: Option<crate::data::PreparedModelMetadata>,
}

#[wasm_bindgen]
impl PreparedModelMetadata {
    pub fn geometry_ids(&self) -> Result<JsValue, JsValue> {
        let prepared = self
            .data
            .as_ref()
            .ok_or_else(|| JsValue::from_str("Model metadata already applied"))?;
        value(&prepared.geometry_ids())
    }
}

#[wasm_bindgen]
impl CatalogData {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<CatalogData, JsValue> {
        Self::from_json(include_str!("../../../content/catalog.json"))
    }

    pub fn from_json(json: &str) -> Result<CatalogData, JsValue> {
        Ok(Self {
            data: crate::data::CatalogData::from_json(json).map_err(|e| JsValue::from_str(&e))?,
        })
    }

    pub fn roots(&self) -> Result<JsValue, JsValue> {
        value(&self.data.roots())
    }
    pub fn group_count(&self) -> usize {
        self.data.catalog.groups.len()
    }
    pub fn target(&self, id: &str) -> Result<JsValue, JsValue> {
        value(&self.data.target(id))
    }
    pub fn members(&self, id: &str) -> Result<JsValue, JsValue> {
        value(&self.data.members(id))
    }
    pub fn lesson_scene_visible_ids(&self, scene: JsValue) -> Result<JsValue, JsValue> {
        let scene: Option<LessonSceneSelection> = read(scene)?;
        value(&self.data.lesson_scene_visible_ids(scene.as_ref()))
    }
    pub fn lesson_scene_models(
        &self,
        model_id: &str,
        model_ids: JsValue,
        scene: JsValue,
    ) -> Result<JsValue, JsValue> {
        let model_ids: Option<Vec<String>> = read(model_ids)?;
        let scene: Option<LessonSceneSelection> = read(scene)?;
        value(&self.data.lesson_scene_models(
            model_id,
            model_ids.as_deref().unwrap_or_default(),
            scene.as_ref(),
        ))
    }
    pub fn lesson_models(&self, lesson: JsValue) -> Result<JsValue, JsValue> {
        let lesson: LessonModelSelection = read(lesson)?;
        value(&self.data.lesson_models(&lesson))
    }
    pub fn lesson_targets(&self, model_ids: JsValue) -> Result<JsValue, JsValue> {
        let model_ids: Vec<String> = read(model_ids)?;
        value(&self.data.lesson_targets(&model_ids))
    }
    pub fn edit_lesson_scene_visibility(
        &self,
        model_ids: JsValue,
        target_id: &str,
        visible_ids: JsValue,
        root: JsValue,
    ) -> Result<JsValue, JsValue> {
        #[derive(serde::Deserialize)]
        struct RootVisibility {
            id: String,
            shown: bool,
        }

        let root: Option<RootVisibility> = read(root)?;
        value(&self.data.edit_lesson_scene_visibility(
            read(model_ids)?,
            target_id,
            read(visible_ids)?,
            root.as_ref().map(|root| (root.id.as_str(), root.shown)),
        ))
    }
    pub fn clear_metadata(&mut self) {
        self.data.clear_metadata();
    }
    pub fn model_metadata_paths(&self) -> Result<JsValue, JsValue> {
        value(
            &self
                .data
                .model_metadata_paths()
                .map_err(|error| JsValue::from_str(&error))?,
        )
    }
    pub fn ingest_model_metadata_files(&mut self, files: JsValue) -> Result<(), JsValue> {
        self.data
            .ingest_model_metadata_files(&read(files)?)
            .map_err(|error| JsValue::from_str(&error))?;
        self.finish()
    }
    pub fn model_load_plan(&self, requested: JsValue, loaded: JsValue) -> Result<JsValue, JsValue> {
        let requested: Option<Vec<String>> = read(requested)?;
        let loaded: Vec<String> = read(loaded)?;
        value(
            &self
                .data
                .model_load_plan(requested.as_deref(), &loaded)
                .map_err(|error| JsValue::from_str(&error))?,
        )
    }
    pub fn prepare_model_metadata(
        &self,
        roots: JsValue,
        json: &str,
    ) -> Result<PreparedModelMetadata, JsValue> {
        let roots: Vec<String> = read(roots)?;
        let data = self
            .data
            .prepare_model_metadata(&roots, json)
            .map_err(|error| JsValue::from_str(&error))?;
        Ok(PreparedModelMetadata { data: Some(data) })
    }
    pub fn ingest_model_metadata(
        &mut self,
        prepared: &mut PreparedModelMetadata,
    ) -> Result<(), JsValue> {
        let data = prepared
            .data
            .take()
            .ok_or_else(|| JsValue::from_str("Model metadata already applied"))?;
        self.data.ingest_model_metadata(data);
        Ok(())
    }
    pub fn ingest_metadata(&mut self, root: &str, json: &str) -> Result<JsValue, JsValue> {
        value(
            &self
                .data
                .ingest(root, json)
                .map_err(|e| JsValue::from_str(&e))?,
        )
    }
    pub fn finish(&mut self) -> Result<(), JsValue> {
        let options = js_sys::Intl::Collator::new(&js_sys::Array::new(), &js_sys::Object::new())
            .resolved_options();
        let locale = js_sys::Reflect::get(&options, &"locale".into())?
            .as_string()
            .ok_or_else(|| JsValue::from_str("Missing collation locale"))?;
        self.data.finish(&locale).map_err(|e| JsValue::from_str(&e))
    }
    pub fn identities(&self) -> Result<JsValue, JsValue> {
        value(&self.data.identities())
    }
    pub fn detail(&self, id: &str) -> Result<JsValue, JsValue> {
        value(&self.data.detail(id))
    }
    pub fn openstax_reference(&self, id: &str) -> Result<JsValue, JsValue> {
        value(&self.data.openstax_reference(id))
    }
    pub fn search(&self, query: &str, language: &str, limit: usize) -> Result<JsValue, JsValue> {
        value(&self.data.search(query, language, limit))
    }
    pub fn search_tree(&self, query: &str, language: &str) -> Result<JsValue, JsValue> {
        value(&self.data.search_tree(query, language))
    }
    pub fn search_targets(
        &self,
        query: &str,
        language: &str,
        limit: usize,
        ids: JsValue,
    ) -> Result<JsValue, JsValue> {
        let ids: Vec<String> = read(ids)?;
        value(
            &self
                .data
                .search_targets(query, language, limit, &ids)
                .map_err(|e| JsValue::from_str(&e))?,
        )
    }
    pub fn search_structures(
        &self,
        query: &str,
        language: &str,
        limit: usize,
        ids: JsValue,
    ) -> Result<JsValue, JsValue> {
        let ids: Vec<String> = read(ids)?;
        value(&self.data.search_structures(query, language, limit, &ids))
    }
    pub fn reveal(&self, id: &str) -> Result<JsValue, JsValue> {
        value(&self.data.reveal(id))
    }
    pub fn tree(
        &self,
        open: JsValue,
        limits: JsValue,
        visible: JsValue,
    ) -> Result<JsValue, JsValue> {
        let open: HashSet<String> = read(open)?;
        let limits: HashMap<String, usize> = read(limits)?;
        let visible: HashSet<String> = read(visible)?;
        value(&self.data.tree(&open, &limits, &visible))
    }
}

#[wasm_bindgen]
pub fn anatomy_names(source: &str) -> Result<JsValue, JsValue> {
    value(&crate::data::names(source))
}

#[wasm_bindgen]
pub fn wikipedia_reference(source: &str) -> Result<JsValue, JsValue> {
    value(&crate::data::reference(source).map_err(|e| JsValue::from_str(&e))?)
}

#[wasm_bindgen]
pub fn structure_name(source: &str, side: &str, language: &str) -> String {
    let names = crate::data::structure_names(source, side);
    if language == "en" { names.en } else { names.vi }
}

#[wasm_bindgen]
pub fn target_name(source: &str, title: &str, language: &str) -> String {
    let names = crate::data::target_names(source, title);
    if language == "en" { names.en } else { names.vi }
}

#[wasm_bindgen]
pub fn validate_metadata(json: &str, expected: JsValue) -> Result<JsValue, JsValue> {
    let expected: Vec<String> = read(expected)?;
    value(&crate::data::parse_metadata(json, &expected).map_err(|e| JsValue::from_str(&e))?)
}

#[wasm_bindgen]
pub fn get_catalog() -> Result<String, JsValue> {
    catalog::catalog_json().map_err(|e| JsValue::from_str(&e.to_string()))
}
