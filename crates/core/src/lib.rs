//! Study navigation metadata, independent of UI and rendering.
//! Catalog IDs identify study entries, not anatomical concepts or mesh instances.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

pub mod lesson;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u32,
    pub groups: Vec<Group>,
    pub targets: Vec<StudyTarget>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct StudyTarget {
    pub id: String,
    pub title: String,
    pub group_id: String,
    pub source_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    pub structure_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<Model>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Model {
    pub path: String,
    pub scope: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sha256: String,
    /// IDs physically stored in this asset; study folders may also reference other assets.
    pub structure_ids: Vec<String>,
}

#[derive(Debug, Error)]
pub enum CatalogError {
    #[error("Catalog JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Unsupported catalog schema version: {0}")]
    UnsupportedVersion(u32),
    #[error("Catalog entries must have nonempty IDs and titles")]
    EmptyField,
    #[error("Duplicate catalog ID: {0}")]
    DuplicateId(String),
    #[error("Study entry {target_id} references unknown group {group_id}")]
    UnknownGroup { target_id: String, group_id: String },
    #[error("Invalid local model descriptor: {0}")]
    InvalidModel(String),
    #[error("Invalid source hierarchy or structure membership: {0}")]
    InvalidHierarchy(String),
}

impl Catalog {
    pub fn from_json(json: &str) -> Result<Self, CatalogError> {
        let catalog: Self = serde_json::from_str(json)?;
        if catalog.schema_version != 1 {
            return Err(CatalogError::UnsupportedVersion(catalog.schema_version));
        }
        let mut ids = HashSet::new();
        for (id, title) in catalog
            .groups
            .iter()
            .map(|g| (&g.id, &g.title))
            .chain(catalog.targets.iter().map(|t| (&t.id, &t.title)))
        {
            if id.trim().is_empty() || title.trim().is_empty() {
                return Err(CatalogError::EmptyField);
            }
            if !ids.insert(id) {
                return Err(CatalogError::DuplicateId(id.clone()));
            }
        }
        let groups: HashSet<_> = catalog.groups.iter().map(|g| &g.id).collect();
        let targets: HashMap<_, _> = catalog.targets.iter().map(|t| (&t.id, t)).collect();
        let asset_members: HashSet<_> = catalog
            .targets
            .iter()
            .filter_map(|t| t.model.as_ref())
            .flat_map(|m| &m.structure_ids)
            .collect();
        for target in &catalog.targets {
            if !groups.contains(&target.group_id) {
                return Err(CatalogError::UnknownGroup {
                    target_id: target.id.clone(),
                    group_id: target.group_id.clone(),
                });
            }
            let members: HashSet<_> = target.structure_ids.iter().collect();
            if target.source_name.trim().is_empty()
                || members.len() != target.structure_ids.len()
                || !members.is_subset(&asset_members)
                || !members.iter().all(|id| {
                    id.strip_prefix("za:")
                        .is_some_and(|s| s.len() == 16 && s.bytes().all(|b| b.is_ascii_hexdigit()))
                })
            {
                return Err(CatalogError::InvalidHierarchy(target.id.clone()));
            }
            if let Some(parent_id) = &target.parent_id {
                let Some(parent) = targets.get(parent_id) else {
                    return Err(CatalogError::InvalidHierarchy(target.id.clone()));
                };
                let parent_members: HashSet<_> = parent.structure_ids.iter().collect();
                if parent.group_id != target.group_id
                    || target.model.is_some()
                    || !members.is_subset(&parent_members)
                {
                    return Err(CatalogError::InvalidHierarchy(target.id.clone()));
                }
                let mut visited = HashSet::from([&target.id]);
                let mut ancestor = Some(parent_id);
                while let Some(id) = ancestor {
                    if !visited.insert(id) {
                        return Err(CatalogError::InvalidHierarchy(target.id.clone()));
                    }
                    let Some(entry) = targets.get(id) else {
                        return Err(CatalogError::InvalidHierarchy(target.id.clone()));
                    };
                    ancestor = entry.parent_id.as_ref();
                }
            } else if target.model.is_none() || members.is_empty() {
                return Err(CatalogError::InvalidHierarchy(target.id.clone()));
            }
            if let Some(model) = &target.model {
                let filename = model.path.strip_prefix("models/z-anatomy/");
                if model.scope.trim().is_empty()
                    || (!model.sha256.is_empty()
                        && (model.sha256.len() != 64
                            || !model.sha256.bytes().all(|b| b.is_ascii_hexdigit())))
                    || model.structure_ids.is_empty()
                    || model.structure_ids.iter().collect::<HashSet<_>>().len()
                        != model.structure_ids.len()
                    || !model.structure_ids.iter().all(|id| members.contains(id))
                    || !filename.is_some_and(|name| {
                        (name.ends_with(".glb") || name.ends_with(".glb.br"))
                            && name.trim_end_matches(".br").len() > 4
                            && name
                                .bytes()
                                .all(|b| b.is_ascii_lowercase() || b == b'.' || b == b'-')
                            && !name.contains("..")
                    })
                {
                    return Err(CatalogError::InvalidModel(target.id.clone()));
                }
            }
        }
        if catalog.groups.iter().any(|g| {
            catalog
                .targets
                .iter()
                .filter(|t| t.group_id == g.id && t.parent_id.is_none())
                .count()
                != 1
        }) {
            return Err(CatalogError::InvalidHierarchy(
                "Each group needs one source root".into(),
            ));
        }
        Ok(catalog)
    }
}

/// Both native and WebAssembly adapters expose this validated catalog.
pub fn catalog_json() -> Result<String, CatalogError> {
    let catalog = Catalog::from_json(include_str!("../../../content/catalog.json"))?;
    Ok(serde_json::to_string(&catalog)?)
}
