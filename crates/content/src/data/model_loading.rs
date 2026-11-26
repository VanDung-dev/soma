use super::{CatalogData, Structure, parse_metadata};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLoadPlan<'a> {
    pub bundle: Option<ModelBundlePlan<'a>>,
    pub requested_count: usize,
    pub loaded_count: usize,
    pub explosion_groups: Vec<&'a [String]>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBundlePlan<'a> {
    pub path: &'a str,
    pub sha256: &'a str,
    pub metadata_path: String,
    pub root_ids: Vec<&'a str>,
}

#[derive(Deserialize)]
struct ModelBundle<'a> {
    manifest: Manifest,
    #[serde(borrow)]
    metadata: HashMap<String, &'a RawValue>,
}

#[derive(Deserialize)]
struct Manifest {
    models: Vec<ManifestModel>,
}

#[derive(Deserialize)]
struct ManifestModel {
    source_ids: Vec<String>,
}

pub struct PreparedModelMetadata {
    ids: Vec<String>,
    parts: Vec<Structure>,
}

impl PreparedModelMetadata {
    pub fn geometry_ids(&self) -> (&[String], Vec<&str>) {
        (
            &self.ids,
            self.parts
                .iter()
                .map(|part| part.source_id.as_str())
                .collect(),
        )
    }
}

impl CatalogData {
    pub fn model_load_plan(
        &self,
        requested: Option<&[String]>,
        loaded: &[String],
    ) -> Result<ModelLoadPlan<'_>, String> {
        let requested_ids =
            requested.map(|ids| ids.iter().map(String::as_str).collect::<HashSet<_>>());
        let loaded_ids: HashSet<_> = loaded.iter().map(String::as_str).collect();
        let mut requested_count = 0;
        let mut loaded_count = 0;
        let mut missing = Vec::new();
        let mut explosion_groups = Vec::new();
        for target in &self.catalog.targets {
            let Some(model) = &target.model else { continue };
            let id = target.id.as_str();
            let requested = requested_ids.as_ref().is_none_or(|ids| ids.contains(id));
            let loaded = loaded_ids.contains(id);
            if requested {
                requested_count += 1;
                if loaded {
                    loaded_count += 1;
                } else {
                    missing.push((id, model));
                }
            }
            if requested || loaded {
                explosion_groups.push(model.structure_ids.as_slice());
            }
        }
        if requested.is_some_and(|ids| ids.len() != requested_count) {
            return Err("Unknown or duplicate model root".into());
        }
        let bundle = if let Some((_, model)) = missing.first() {
            if missing
                .iter()
                .any(|(_, other)| other.path != model.path || other.sha256 != model.sha256)
            {
                return Err("Model roots must share one bundle".into());
            }
            let path = model.path.strip_suffix(".br").unwrap_or(&model.path);
            let stem = path
                .strip_suffix(".glb")
                .ok_or("Invalid model bundle path")?;
            Some(ModelBundlePlan {
                path: &model.path,
                sha256: &model.sha256,
                metadata_path: format!("{stem}.json"),
                root_ids: missing.iter().map(|(id, _)| *id).collect(),
            })
        } else {
            explosion_groups.clear();
            None
        };
        Ok(ModelLoadPlan {
            bundle,
            requested_count,
            loaded_count,
            explosion_groups,
        })
    }

    pub fn prepare_model_metadata(
        &self,
        root_ids: &[String],
        json: &str,
    ) -> Result<PreparedModelMetadata, String> {
        let bundle: ModelBundle<'_> =
            serde_json::from_str(json).map_err(|_| "Invalid model bundle metadata")?;
        let mut parts = Vec::new();
        for root in root_ids {
            let model = self.model(root)?;
            let metadata = bundle.metadata.get(root).ok_or("Missing system metadata")?;
            parts.extend(parse_metadata(metadata.get(), &model.structure_ids)?);
        }
        let ids = bundle
            .manifest
            .models
            .into_iter()
            .flat_map(|model| model.source_ids)
            .collect();
        Ok(PreparedModelMetadata { ids, parts })
    }

    pub fn ingest_model_metadata(&mut self, prepared: PreparedModelMetadata) {
        self.ingest_model_parts(prepared.parts);
    }
}
