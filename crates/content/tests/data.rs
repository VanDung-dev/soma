use content::data::{
    CatalogData, LessonModelSelection, LessonSceneSelection, SearchRow, normalize, parse_metadata,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};

const SOURCE: &str = include_str!("../../../content/catalog.json");
fn bundle() -> &'static serde_json::Value {
    static BUNDLE: std::sync::OnceLock<serde_json::Value> = std::sync::OnceLock::new();
    BUNDLE.get_or_init(|| {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/web/public/models/z-anatomy/z-anatomy.json");
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    })
}

fn metadata() -> &'static str {
    static METADATA: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    METADATA.get_or_init(|| {
        let model = bundle()["manifest"]["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|model| model["file"] == "skeletal-system.glb")
            .unwrap();
        bundle()["metadata"][model["root_id"].as_str().unwrap()].to_string()
    })
}

fn structure_id<'a>(row: &SearchRow<'a>) -> &'a str {
    match row {
        SearchRow::Structure(row) => row.source_id,
        SearchRow::Target(_) => panic!("Expected a structure"),
    }
}

#[test]
fn skull_search_returns_the_linked_group_without_midword_noise() {
    let mut data = CatalogData::from_json(SOURCE).unwrap();
    let packages: Vec<_> = data
        .catalog
        .targets
        .iter()
        .filter_map(|target| {
            target
                .model
                .as_ref()
                .map(|model| (target.id.clone(), model.path.clone()))
        })
        .collect();
    for (id, _) in packages {
        data.ingest(&id, &bundle()["metadata"][&id].to_string())
            .unwrap();
    }
    data.finish("en-US").unwrap();
    let skull = data
        .catalog
        .targets
        .iter()
        .find(|target| target.source_name == "Cranium")
        .unwrap();
    for query in ["sọ", "SỌ", " so ", "Cranium"] {
        let page = data.search(query, "vi", 20);
        let SearchRow::Target(first) = &page.items[0] else {
            panic!("Find the skull group first: {query}")
        };
        assert_eq!(first.id, skull.id);
        assert_eq!(first.names.vi, "Sọ");
        assert_eq!(first.count, 54);
        assert_eq!(data.members(first.id).unwrap(), skull.structure_ids);
    }
    let page = data.search("sọ", "vi", usize::MAX);
    assert!(!page.items.iter().any(
        |row| matches!(row, SearchRow::Structure(row) if row.source_id == "za:a250b6a53af7f133")
    ));
    assert!(page.items.iter().any(
        |row| matches!(row, SearchRow::Structure(row) if row.names.vi == "Cân trên sọ · trái")
    ));
    assert_eq!(data.search("extens", "en", 1).items.len(), 1);
    let path = data.reveal(&skull.id);
    assert_eq!(path[0].0, skull.id);
    assert_eq!(&path[1].0, skull.parent_id.as_ref().unwrap());
    for query in ["sọ", "SO\u{323}", "so", "Cranium"] {
        let tree = data.search_tree(query, "vi").unwrap();
        assert_eq!(tree.best_id.as_deref(), Some(skull.id.as_str()));
        assert!(tree.folders.contains(&skull.id));
        let ancestors: Vec<_> = path.iter().skip(1).map(|(id, _)| id.clone()).collect();
        assert_eq!(tree.initial_open, ancestors);
        assert!(!tree.structures.contains_key("za:a250b6a53af7f133"));
    }
    let tree = data.search_tree("sọ", "vi").unwrap();
    assert_eq!(tree.highlights["Sọ"], [0, 2]);
    assert_eq!(tree.highlights["Cân trên sọ · trái"], [9, 11]);
    for (query, end) in [("N", 1), ("n", 1), ("Ne", 2)] {
        let tree = data.search_tree(query, "vi").unwrap();
        assert!(tree.best_id.is_some());
        assert_eq!(tree.highlights["Nervus opticus (II)"], [0, end]);
    }
    let tree = data.search_tree("so", "vi").unwrap();
    assert!(!tree.highlights.contains_key("Các sợi vòng mi · phải"));
    assert!(data.search_tree("---", "vi").is_none());
    assert_eq!(data.search("sọ", "vi", 0).total, page.total);
    assert!(data.search("sọ", "vi", 0).items.is_empty());
    data.clear_metadata();
    assert!(data.search("sọ", "vi", 20).items.is_empty());
}

#[test]
fn tree_search_ranks_all_catalog_matches_without_the_editor_candidate_limit() {
    let mut data = CatalogData::from_json(SOURCE).unwrap();
    let mut metadata: serde_json::Value = serde_json::from_str(metadata()).unwrap();
    let parts = metadata["structures"].as_array_mut().unwrap();
    for part in &mut parts[..120] {
        part["source_name"] = "Tree search sample".into();
        part["laterality"] = "".into();
    }
    parts[120]["source_name"] = "Tree search".into();
    parts[120]["laterality"] = "".into();
    let exact_id = parts[120]["source_id"].as_str().unwrap().to_owned();
    data.ingest("collection:baf3076d0495a617", &metadata.to_string())
        .unwrap();
    data.finish("en").unwrap();

    let tree = data.search_tree("tree search", "en").unwrap();
    assert_eq!(tree.best_id.as_deref(), Some(exact_id.as_str()));
    assert_eq!(tree.structures.len(), 121);
    assert_eq!(tree.structures[&exact_id], data.reveal(&exact_id)[0].0);
    assert_eq!(tree.highlights["Tree search sample"], [0, 11]);
}

#[test]
fn normalization_preserves_bilingual_search_rules() {
    assert_eq!(normalize("  XƯƠNG ĐÙI · trái! "), "xuong dui trai");
    assert_eq!(normalize("ĐỘNG MẠCH"), "dong mach");
    assert_eq!(normalize("e\u{301} A–Z 🦴 123"), "e a z 123");
    assert_eq!(normalize("---"), "");
    assert_eq!(normalize("İstanbul"), "istanbul");
}

#[test]
fn scoped_search_uses_catalog_names_before_any_models_load() {
    let data = CatalogData::from_json(SOURCE).unwrap();
    let ids = [
        "collection:94f4f0afe3598035".to_owned(),
        "collection:a6f4bb7246cd6e74".to_owned(),
    ];
    for query in ["cau nao", "CẦU NÃO", "Pons"] {
        let page = data.search_targets(query, "vi", 1, &ids).unwrap();
        assert_eq!(page.total, 1);
        assert!(matches!(&page.items[0], SearchRow::Target(target) if target.id == ids[0]));
    }
    assert_eq!(
        data.search_targets("Pons", "vi", 20, &ids[1..])
            .unwrap()
            .total,
        0
    );
    assert_eq!(data.search_targets("", "en", 1, &ids).unwrap().total, 2);
    assert_eq!(data.search("Pons", "vi", 20).total, 0);
}

#[test]
fn scoped_part_search_returns_only_allowed_meshes() {
    let mut data = CatalogData::from_json(SOURCE).unwrap();
    data.ingest("collection:baf3076d0495a617", metadata())
        .unwrap();
    data.finish("vi").unwrap();
    let ids = ["za:8e8f88fe40d45d19".to_owned()];
    for query in ["xuong tran", "Frontal bone", "Os frontale", ""] {
        let page = data.search_structures(query, "vi", 20, &ids);
        assert_eq!(page.total, 1);
        assert_eq!(structure_id(&page.items[0]), ids[0]);
    }
    assert_eq!(data.search_structures("Femur", "en", 20, &ids).total, 0);
}

#[test]
fn openstax_related_readings_prefer_specific_collections_and_inherit_group_context() {
    let mut data = CatalogData::from_json(SOURCE).unwrap();
    let root = data
        .roots()
        .into_iter()
        .find(|root| root.source_name == "1: Skeletal system")
        .unwrap()
        .id
        .to_owned();
    data.ingest(&root, metadata()).unwrap();
    data.finish("en-US").unwrap();
    let parts: serde_json::Value = serde_json::from_str(metadata()).unwrap();
    for (name, section) in [
        ("Parietal bone", "7-2-the-skull"),
        ("Femur", "8-4-bones-of-the-lower-limb"),
    ] {
        let part = parts["structures"]
            .as_array()
            .unwrap()
            .iter()
            .find(|part| part["source_name"] == name)
            .unwrap();
        let reference = data
            .openstax_reference(part["source_id"].as_str().unwrap())
            .unwrap();
        assert!(reference.url.ends_with(section));
    }
    for (name, section) in [
        ("1: Skeletal system", "7-1-divisions-of-the-skeletal-system"),
        ("Cranium", "7-2-the-skull"),
        ("Vertebral body", "7-3-the-vertebral-column"),
    ] {
        let target = data
            .catalog
            .targets
            .iter()
            .find(|target| target.source_name == name)
            .unwrap();
        assert!(
            data.openstax_reference(&target.id)
                .unwrap()
                .url
                .ends_with(section)
        );
    }
    assert!(data.openstax_reference("unknown").is_none());
    let mut unknown: serde_json::Value = serde_json::from_str(SOURCE).unwrap();
    let id = unknown["targets"][0]["id"].as_str().unwrap().to_owned();
    unknown["targets"][0]["source_name"] = "Unmapped topic".into();
    assert!(
        CatalogData::from_json(&unknown.to_string())
            .unwrap()
            .openstax_reference(&id)
            .is_none()
    );
}

#[test]
fn source_ties_follow_host_collation_and_invalid_locale_keeps_index() {
    let mut data = CatalogData::from_json(SOURCE).unwrap();
    let root = data
        .catalog
        .targets
        .iter()
        .find(|t| t.source_name == "1: Skeletal system")
        .unwrap()
        .id
        .clone();
    let mut metadata: serde_json::Value = serde_json::from_str(metadata()).unwrap();
    for (i, object) in ["ä", "z"].iter().enumerate() {
        metadata["structures"][i]["source_name"] = "Collation test".into();
        metadata["structures"][i]["laterality"] = "".into();
        metadata["structures"][i]["source_object"] = (*object).into();
    }
    let ids: Vec<_> = metadata["structures"].as_array().unwrap()[..2]
        .iter()
        .map(|p| p["source_id"].as_str().unwrap().to_owned())
        .collect();
    data.ingest(&root, &metadata.to_string()).unwrap();
    for (locale, expected) in [("de", [0, 1]), ("sv", [1, 0])] {
        data.finish(locale).unwrap();
        let order: Vec<_> = data
            .identities()
            .into_iter()
            .filter(|id| ids.iter().any(|expected| expected == id))
            .collect();
        assert_eq!(order, expected.map(|i| ids[i].as_str()));
    }
    let before: Vec<_> = data.identities().into_iter().map(str::to_owned).collect();
    assert!(data.finish("invalid_locale!").is_err());
    assert_eq!(data.identities(), before);
}

#[test]
fn metadata_validation_preserves_all_source_fields_and_is_atomic() {
    let mut data = CatalogData::from_json(SOURCE).unwrap();
    let root = data
        .catalog
        .targets
        .iter()
        .find(|t| t.source_name == "1: Skeletal system")
        .unwrap()
        .id
        .clone();
    let expected = data.members(&root).unwrap().to_vec();
    let parts = parse_metadata(metadata(), &expected).unwrap();
    let original: serde_json::Value = serde_json::from_str(metadata()).unwrap();
    assert_eq!(
        serde_json::to_value(&parts).unwrap(),
        original["structures"]
    );
    data.ingest(&root, metadata()).unwrap();
    data.finish("en-US").unwrap();
    let before = data.identities();
    assert_eq!(before.len(), expected.len());
    let before = before.into_iter().map(str::to_owned).collect::<Vec<_>>();
    for invalid in ["null", "{}", "{", r#"{"structures":[]}"#] {
        assert!(data.ingest(&root, invalid).is_err());
        assert_eq!(data.identities(), before);
    }
    assert!(parse_metadata(metadata(), &expected[1..]).is_err());
    let mut duplicate = original;
    duplicate["structures"][1] = duplicate["structures"][0].clone();
    assert!(data.ingest(&root, &duplicate.to_string()).is_err());
    assert_eq!(data.identities(), before);
    let page = data.search("xuong dui trai", "vi", 20);
    let SearchRow::Structure(first) = &page.items[0] else {
        panic!("Expected femur")
    };
    assert!(first.names.vi.starts_with("Xương đùi · trái"));
    assert!(data.search("---", "vi", 20).items.is_empty());
    for language in ["vi", "en"] {
        let all = data.search("", language, usize::MAX);
        for limit in [0, 1, 20, usize::MAX] {
            let page = data.search(" \t\n", language, limit);
            assert_eq!(page.total, expected.len());
            assert_eq!(
                page.items.iter().map(structure_id).collect::<Vec<_>>(),
                all.items
                    .iter()
                    .take(limit)
                    .map(structure_id)
                    .collect::<Vec<_>>()
            );
        }
    }
    data.clear_metadata();
    assert!(data.identities().is_empty());
    assert!(data.detail(&expected[0]).is_none());
}

#[test]
fn tree_snapshots_keep_display_membership_and_bound_direct_rows() {
    let mut data = CatalogData::from_json(SOURCE).unwrap();
    let root = data
        .catalog
        .targets
        .iter()
        .find(|t| t.source_name == "1: Skeletal system")
        .unwrap()
        .id
        .clone();
    let ids = data.members(&root).unwrap().to_vec();
    data.ingest(&root, metadata()).unwrap();
    data.finish("en-US").unwrap();
    let visible: HashSet<_> = ids.iter().cloned().collect();
    let closed = data.tree(&HashSet::new(), &HashMap::new(), &visible);
    assert_eq!(closed.len(), 9);
    for folder in &closed {
        let expected = data.members(folder.target.id).unwrap();
        assert_eq!(folder.target.count, expected.len());
        assert_eq!(
            folder.visible,
            expected.iter().filter(|id| visible.contains(*id)).count()
        );
        assert!(folder.structures.is_empty() && folder.children.is_empty());
    }
    let open = HashSet::from([root.clone()]);
    let opened = data.tree(&open, &HashMap::new(), &visible);
    let folder = opened.iter().find(|f| f.target.id == root).unwrap();
    assert!(folder.structures.len() <= 40);
    assert!(!folder.children.is_empty());
    let first = data.identities()[0];
    let path = data.reveal(first);
    assert!(!path.is_empty());
    assert_eq!(path.last().unwrap().0, root);
    assert!(data.reveal("unknown").is_empty());
}

#[test]
fn lesson_targets_keep_the_catalog_tree_order_for_each_requested_root() {
    let data = CatalogData::from_json(SOURCE).unwrap();
    let roots: Vec<_> = data
        .roots()
        .into_iter()
        .rev()
        .map(|root| root.id.to_owned())
        .collect();
    let open: HashSet<_> = data
        .catalog
        .targets
        .iter()
        .map(|target| target.id.clone())
        .collect();
    let folders = data.tree(&open, &HashMap::new(), &HashSet::new());
    let mut expected = Vec::new();
    for id in &roots {
        let root = folders
            .iter()
            .find(|folder| folder.target.id == id.as_str())
            .unwrap();
        let mut breadth_first = std::collections::VecDeque::from([root]);
        while let Some(folder) = breadth_first.pop_front() {
            if folder.target.count > 0 {
                expected.push(folder.target.id);
            }
            breadth_first.extend(&folder.children);
        }
    }
    let actual: Vec<_> = data
        .lesson_targets(&roots)
        .into_iter()
        .map(|target| target.id)
        .collect();
    assert_eq!(actual, expected);
    let child = folders
        .iter()
        .find_map(|folder| folder.children.first())
        .unwrap();
    assert!(
        data.lesson_targets(&[child.target.id.to_owned(), "missing".into()])
            .is_empty()
    );
}

#[test]
fn lesson_model_selection_preserves_explicit_lists_and_preload_order() {
    let data = CatalogData::from_json(SOURCE).unwrap();
    let roots = data.roots();
    let first = roots[0].id;
    let second = roots[1].id;
    let third = roots[2].id;
    let lesson: LessonModelSelection = serde_json::from_value(json!({
        "modelId": first,
        "preloadModelIds": [second, first],
        "scene": { "targetId": third, "modelIds": [] },
        "steps": [
            { "kind": "text", "targetId": third, "visibleIds": 3, "modelIds": [third] },
            { "kind": "observe", "targetId": second, "modelIds": [second] },
        ],
    }))
    .unwrap();
    assert_eq!(data.lesson_models(&lesson), [second, first]);

    let scene: LessonSceneSelection = serde_json::from_value(json!({ "targetId": first })).unwrap();
    assert_eq!(data.lesson_scene_models("", &[], Some(&scene)), [first]);
    assert_eq!(
        data.lesson_scene_visible_ids(Some(&scene)),
        data.members(first).unwrap()
    );

    let empty: LessonSceneSelection =
        serde_json::from_value(json!({ "targetId": first, "visibleIds": [] })).unwrap();
    assert!(data.lesson_scene_visible_ids(Some(&empty)).is_empty());
    assert!(data.lesson_scene_models("", &[], Some(&empty)).is_empty());
}
