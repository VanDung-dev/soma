use content::data::{CatalogData, normalize, parse_metadata};
use std::collections::{HashMap, HashSet};

const SOURCE: &str = include_str!("../../../content/catalog.json");
const METADATA: &str =
    include_str!("../../../apps/web/public/models/z-anatomy/skeletal-system.json");

#[test]
fn normalization_preserves_bilingual_search_rules() {
    assert_eq!(normalize("  XƯƠNG ĐÙI · trái! "), "xuong dui trai");
    assert_eq!(normalize("ĐỘNG MẠCH"), "dong mach");
    assert_eq!(normalize("e\u{301} A–Z 🦴 123"), "e a z 123");
    assert_eq!(normalize("---"), "");
    assert_eq!(normalize("İstanbul"), "istanbul");
}

#[test]
fn source_ties_follow_host_collation_and_invalid_locale_keeps_index() {
    let mut data = CatalogData::from_json(SOURCE).unwrap();
    let root = data
        .catalog
        .targets
        .iter()
        .find(|t| {
            t.model
                .as_ref()
                .is_some_and(|m| m.path.ends_with("/skeletal-system.glb"))
        })
        .unwrap()
        .id
        .clone();
    let mut metadata: serde_json::Value = serde_json::from_str(METADATA).unwrap();
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
        .find(|t| {
            t.model
                .as_ref()
                .is_some_and(|m| m.path.ends_with("/skeletal-system.glb"))
        })
        .unwrap()
        .id
        .clone();
    let expected = data.members(&root).unwrap().to_vec();
    let parts = parse_metadata(METADATA, &expected).unwrap();
    let original: serde_json::Value = serde_json::from_str(METADATA).unwrap();
    assert_eq!(
        serde_json::to_value(&parts).unwrap(),
        original["structures"]
    );
    data.ingest(&root, METADATA).unwrap();
    data.finish("en-US").unwrap();
    let before = data.identities();
    assert_eq!(before.len(), expected.len());
    let before = before.into_iter().map(str::to_owned).collect::<Vec<_>>();
    for invalid in ["null", "{}", "{", r#"{"structures":[]}"#] {
        assert!(data.ingest(&root, invalid).is_err());
        assert_eq!(data.identities(), before);
    }
    assert!(parse_metadata(METADATA, &expected[1..]).is_err());
    let mut duplicate = original;
    duplicate["structures"][1] = duplicate["structures"][0].clone();
    assert!(data.ingest(&root, &duplicate.to_string()).is_err());
    assert_eq!(data.identities(), before);
    let page = data.search("xuong dui trai", "vi", 20);
    assert!(page.items[0].names.vi.starts_with("Xương đùi · trái"));
    assert!(data.search("---", "vi", 20).items.is_empty());
    for language in ["vi", "en"] {
        let all = data.search("", language, usize::MAX);
        for limit in [0, 1, 20, usize::MAX] {
            let page = data.search(" \t\n", language, limit);
            assert_eq!(page.total, expected.len());
            assert_eq!(
                page.items
                    .iter()
                    .map(|row| row.source_id)
                    .collect::<Vec<_>>(),
                all.items
                    .iter()
                    .take(limit)
                    .map(|row| row.source_id)
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
        .find(|t| {
            t.model
                .as_ref()
                .is_some_and(|m| m.path.ends_with("/skeletal-system.glb"))
        })
        .unwrap()
        .id
        .clone();
    let ids = data.members(&root).unwrap().to_vec();
    data.ingest(&root, METADATA).unwrap();
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
