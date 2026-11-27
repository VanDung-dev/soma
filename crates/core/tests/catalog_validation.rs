use catalog::{Catalog, CatalogError, catalog_json};

const STARTER: &str = include_str!("../../../content/catalog.json");

#[test]
fn accepts_glb_and_brotli_model_paths_and_rejects_other_formats() {
    assert!(Catalog::from_json(STARTER).is_ok());
    assert!(
        changed(|v| {
            let path = v["targets"][0]["model"]["path"].as_str().unwrap();
            v["targets"][0]["model"]["path"] = path.trim_end_matches(".br").into();
        })
        .is_ok()
    );
    assert!(matches!(
        changed(|v| v["targets"][0]["model"]["path"] = "models/z-anatomy/model.glb.gz".into()),
        Err(CatalogError::InvalidModel(_))
    ));
    assert!(
        changed(|v| {
            v["targets"][0]["model"]
                .as_object_mut()
                .unwrap()
                .remove("sha256");
        })
        .is_ok()
    );
    for hash in ["short", &"g".repeat(64)] {
        assert!(matches!(
            changed(|v| v["targets"][0]["model"]["sha256"] = hash.into()),
            Err(CatalogError::InvalidModel(_))
        ));
    }
}

#[test]
fn source_catalog_has_nine_roots_and_deep_navigation() {
    let catalog = Catalog::from_json(&catalog_json().unwrap()).unwrap();
    assert_eq!(catalog.groups.len(), 9);
    assert_eq!(catalog.targets.len(), 1981);
    assert_eq!(
        catalog.targets.iter().filter(|t| t.model.is_some()).count(),
        9
    );
    assert_eq!(catalog.targets[0].source_name, "1: Skeletal system");
    assert!(
        catalog
            .targets
            .iter()
            .any(|t| t.source_name == "Right atrium")
    );
    assert!(catalog.targets.iter().any(|t| t.structure_ids.is_empty()));
}

fn changed(edit: impl FnOnce(&mut serde_json::Value)) -> Result<Catalog, CatalogError> {
    let mut value = serde_json::from_str(STARTER).unwrap();
    edit(&mut value);
    Catalog::from_json(&serde_json::to_string(&value).unwrap())
}

#[test]
fn rejects_incompatible_and_ambiguous_data() {
    assert!(matches!(
        changed(|v| v["schema_version"] = 4.into()),
        Err(CatalogError::UnsupportedVersion(4))
    ));
    assert!(matches!(
        changed(|v| v["targets"][1]["id"] = v["targets"][0]["id"].clone()),
        Err(CatalogError::DuplicateId(_))
    ));
    assert!(matches!(
        changed(|v| v["targets"][0]["group_id"] = "missing".into()),
        Err(CatalogError::UnknownGroup { .. })
    ));
    assert!(matches!(
        changed(|v| v["targets"][0]["title"] = " ".into()),
        Err(CatalogError::EmptyField)
    ));
    assert!(matches!(
        Catalog::from_json("{"),
        Err(CatalogError::Json(_))
    ));
    assert!(matches!(
        changed(|v| v["targets"][0]["model"]["path"] = "https://example.com/model.glb".into()),
        Err(CatalogError::InvalidModel(_))
    ));
}

#[test]
fn rejects_broken_hierarchy_and_membership() {
    for edit in [
        (|v: &mut serde_json::Value| v["targets"][1]["parent_id"] = "missing".into())
            as fn(&mut serde_json::Value),
        |v| v["targets"][1]["parent_id"] = v["targets"][1]["id"].clone(),
        |v| v["targets"][1]["group_id"] = v["groups"][1]["id"].clone(),
        |v| v["targets"][1]["structure_ids"] = serde_json::json!(["za:ffffffffffffffff"]),
        |v| v["targets"][1]["structure_ids"] = serde_json::json!(["bad-id"]),
        |v| {
            let id = v["targets"][0]["structure_ids"][0].clone();
            v["targets"][1]["structure_ids"] = serde_json::json!([id, id]);
        },
        |v| {
            v["targets"][0]
                .as_object_mut()
                .unwrap()
                .remove("model")
                .map(|_| ())
                .unwrap()
        },
        |v| v["targets"][1]["model"] = v["targets"][0]["model"].clone(),
    ] {
        assert!(matches!(
            changed(edit),
            Err(CatalogError::InvalidHierarchy(_))
        ));
    }
}

#[test]
fn source_folders_can_reference_geometry_from_another_asset() {
    let catalog = Catalog::from_json(STARTER).unwrap();
    let thorax = catalog
        .targets
        .iter()
        .find(|t| t.source_name == "Thorax")
        .unwrap();
    let root = catalog
        .targets
        .iter()
        .find(|t| t.group_id == thorax.group_id && t.model.is_some())
        .unwrap();
    assert!(!thorax.structure_ids.is_empty());
    assert!(
        thorax.structure_ids.iter().any(|id| !root
            .model
            .as_ref()
            .unwrap()
            .structure_ids
            .contains(id))
    );
    assert!(matches!(
        changed(|v| {
            v["targets"][0]["structure_ids"]
                .as_array_mut()
                .unwrap()
                .push("za:ffffffffffffffff".into());
        }),
        Err(CatalogError::InvalidHierarchy(_))
    ));
    for edit in [
        (|v: &mut serde_json::Value| {
            v["targets"][0]["model"]["structure_ids"] = serde_json::json!([])
        }) as fn(&mut serde_json::Value),
        |v| v["targets"][0]["model"]["structure_ids"] = serde_json::json!(["za:ffffffffffffffff"]),
        |v| {
            let id = v["targets"][0]["model"]["structure_ids"][0].clone();
            v["targets"][0]["model"]["structure_ids"] = serde_json::json!([id.clone(), id]);
        },
    ] {
        assert!(matches!(
            changed(edit),
            Err(CatalogError::InvalidModel(_) | CatalogError::InvalidHierarchy(_))
        ));
    }
}
