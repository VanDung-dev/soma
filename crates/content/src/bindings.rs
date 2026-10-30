use serde::{Serialize, de::DeserializeOwned};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

fn value<T: Serialize>(data: &T) -> Result<JsValue, JsValue> {
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
    pub fn clear_metadata(&mut self) {
        self.data.clear_metadata();
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
