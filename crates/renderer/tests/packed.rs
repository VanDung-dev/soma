mod support;

use renderer::{PackedScene, Scene};
use support::ModelFixture;

#[test]
fn worker_packing_preserves_geometry_and_validates_transfer_ranges() {
    let mut fixture = ModelFixture::new();
    let ids = fixture.select("body-regions");
    let scene = Scene::from_glb(&fixture.bytes(), &ids).unwrap();
    let vertices: Vec<_> = scene
        .parts
        .iter()
        .flat_map(|p| p.vertices.iter().copied())
        .collect();
    let mut indices = Vec::new();
    let mut base = 0u32;
    for part in &scene.parts {
        indices.extend(part.indices.iter().map(|i| i + base));
        base += (part.vertices.len() / 6) as u32;
    }
    let bounds = scene.bounds;
    let (packed, transferred_vertices, transferred_indices) = scene.pack().unwrap();
    assert_eq!(transferred_vertices, vertices);
    assert_eq!(transferred_indices, indices);
    assert!(
        packed
            .scene
            .parts
            .iter()
            .all(|p| p.vertices.is_empty() && p.indices.is_empty())
    );
    assert_eq!(packed.scene.bounds.min, bounds.min);
    assert_eq!(packed.scene.bounds.max, bounds.max);
    let mut restored: PackedScene =
        serde_json::from_str(&serde_json::to_string(&packed).unwrap()).unwrap();
    restored.validate(vertices.len(), indices.len()).unwrap();
    assert!(
        restored
            .validate(vertices.len() - 1, indices.len())
            .is_err()
    );
    assert!(
        restored
            .validate(vertices.len(), indices.len() - 1)
            .is_err()
    );
    restored.draws[0].1 = 4;
    assert!(restored.validate(vertices.len(), indices.len()).is_err());
    restored.draws[0].1 = 0;
    restored.scene.parts[0].bounds.max.x = f32::NAN;
    assert!(restored.validate(vertices.len(), indices.len()).is_err());
}
