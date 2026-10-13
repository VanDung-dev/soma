use anatomy_renderer::{Reconstruction, Scene};
use std::path::Path;

#[test]
fn reconstruction_reveals_feet_before_head_and_finishes_without_changing_visibility() {
    let folder =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/models/z-anatomy");
    let meta: serde_json::Value =
        serde_json::from_slice(&std::fs::read(folder.join("body-regions.json")).unwrap()).unwrap();
    let ids: Vec<String> = meta["structures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["source_id"].as_str().unwrap().into())
        .collect();
    let scene = Scene::from_glb(
        &std::fs::read(folder.join("body-regions.glb")).unwrap(),
        &ids,
    )
    .unwrap();
    let mut reconstruction = Reconstruction::default();
    reconstruction
        .append(&scene.parts, scene.bounds, 1000.0, true)
        .unwrap();
    assert!((0..scene.parts.len()).all(|i| reconstruction.opacity(i) == 0.0));
    assert!(reconstruction.advance(1550.0).unwrap());
    let low = (0..scene.parts.len())
        .min_by(|&a, &b| {
            scene.parts[a]
                .bounds
                .center()
                .y
                .total_cmp(&scene.parts[b].bounds.center().y)
        })
        .unwrap();
    let high = (0..scene.parts.len())
        .max_by(|&a, &b| {
            scene.parts[a]
                .bounds
                .center()
                .y
                .total_cmp(&scene.parts[b].bounds.center().y)
        })
        .unwrap();
    assert!(reconstruction.opacity(low) > reconstruction.opacity(high));
    let before = reconstruction.opacity(low);
    assert!(reconstruction.advance(f64::NAN).is_err());
    assert!(reconstruction.advance(1500.0).is_err());
    assert_eq!(reconstruction.opacity(low), before);
    reconstruction
        .append(&scene.parts, scene.bounds, 1600.0, true)
        .unwrap();
    assert!(reconstruction.opacity(low) >= before);
    assert!(!reconstruction.advance(5000.0).unwrap());
    assert!((0..scene.parts.len() * 2).all(|i| reconstruction.opacity(i) == 1.0));
    assert_eq!(scene.visible_count(), ids.len());
    let mut reduced = Reconstruction::default();
    reduced
        .append(&scene.parts, scene.bounds, 1000.0, false)
        .unwrap();
    assert!(!reduced.advance(1000.0).unwrap());
    assert!((0..scene.parts.len()).all(|i| reduced.opacity(i) == 1.0));
    reconstruction
        .append(&scene.parts, scene.bounds, 5000.0, true)
        .unwrap();
    reconstruction.finish();
    assert!(!reconstruction.advance(5000.0).unwrap());
}
