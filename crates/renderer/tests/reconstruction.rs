mod support;

use renderer::{Primitive, Reconstruction, Scene};
use support::ModelFixture;

#[test]
fn inventory_replacement_hides_the_old_system_before_revealing_the_new_one() {
    let mut parts: Vec<Primitive> = (0..2).map(|i| serde_json::from_value(serde_json::json!({
        "source_id": i.to_string(), "bounds": {"min": [0.0,i as f32,0.0], "max": [0.1,i as f32 + 0.1,0.1]},
        "color": [0.5,0.5,0.5,1.0], "roughness": 0.6, "metallic": 0.0,
        "specular": 0.04, "subsurface": 0.0, "double_sided": false, "blend": false,
        "alpha_cutoff": 0.0, "active": true, "visible": i == 0
    })).unwrap()).collect();
    let mut reveal = Reconstruction::default();
    reveal
        .append(&parts, parts[0].bounds.union(parts[1].bounds), 0.0, false)
        .unwrap();
    parts[0].visible = false;
    parts[1].visible = true;
    reveal
        .set_inventory_visibility(&parts, Some(100.0))
        .unwrap();
    reveal.advance(250.0).unwrap();
    assert!((reveal.opacity(0) - 0.5).abs() < 1e-6);
    assert_eq!(reveal.opacity(1), 0.0);
    reveal.advance(400.0).unwrap();
    assert_eq!(reveal.opacity(0), 0.0);
    assert_eq!(reveal.opacity(1), 0.0);
    reveal.advance(550.0).unwrap();
    assert!((reveal.opacity(1) - 0.5).abs() < 1e-6);
    parts[0].visible = true;
    parts[1].visible = false;
    reveal.set_inventory_visibility(&parts, None).unwrap();
    assert_eq!(reveal.opacity(0), 1.0);
    assert_eq!(reveal.opacity(1), 0.0);
}

#[test]
fn visibility_reveals_only_changed_parts_and_reverses_from_the_displayed_value() {
    let mut parts: Vec<Primitive> = (0..3).map(|i| serde_json::from_value(serde_json::json!({
        "source_id": i.to_string(), "bounds": {"min": [0.0,i as f32,0.0], "max": [0.1,i as f32 + 0.1,0.1]},
        "color": [0.5,0.5,0.5,1.0], "roughness": 0.6, "metallic": 0.0,
        "specular": 0.04, "subsurface": 0.0, "double_sided": false, "blend": false,
        "alpha_cutoff": 0.0, "active": true, "visible": true
    })).unwrap()).collect();
    let mut reveal = Reconstruction::default();
    reveal
        .append(&parts, parts[0].bounds.union(parts[2].bounds), 0.0, false)
        .unwrap();
    parts[0].visible = false;
    parts[1].visible = false;
    reveal.set_visibility(&parts, Some(1000.0)).unwrap();
    assert_eq!(reveal.opacity(0), 1.0);
    assert!(reveal.fading_out(0));
    assert!(reveal.advance(1150.0).unwrap());
    assert!((reveal.opacity(0) - 0.5).abs() < 1e-6);
    assert_eq!(reveal.opacity(1), 1.0, "Hide from the feet upward");
    assert_eq!(reveal.opacity(2), 1.0, "Leave other systems unchanged");
    parts[0].visible = true;
    reveal.set_visibility(&parts, Some(1150.0)).unwrap();
    assert!(
        (reveal.opacity(0) - 0.5).abs() < 1e-6,
        "Rapid reversal must not jump"
    );
    assert!(!reveal.fading_out(0));
    assert!(reveal.set_visibility(&parts, Some(f64::NAN)).is_err());
    assert!(reveal.set_visibility(&parts, Some(1100.0)).is_err());
    reveal.finish();
    assert_eq!(reveal.opacity(0), 1.0);
    assert_eq!(reveal.opacity(1), 0.0);
    assert!(!reveal.fading_out(1));
    parts[1].visible = true;
    reveal.set_visibility(&parts, None).unwrap();
    assert_eq!(
        reveal.opacity(1),
        1.0,
        "Reduced motion must finish immediately"
    );
    assert!(!reveal.advance(2000.0).unwrap());
}

#[test]
fn reconstruction_reveals_feet_before_head_and_finishes_without_changing_visibility() {
    let mut fixture = ModelFixture::new();
    let ids = fixture.select("body-regions");
    let scene = Scene::from_glb(&fixture.bytes(), &ids).unwrap();
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

    let mut delayed = Reconstruction::default();
    let mut reference = Reconstruction::default();
    for _ in 0..2 {
        delayed
            .append(&scene.parts[..1], scene.bounds, 1000.0, true)
            .unwrap();
        reference
            .append(&scene.parts[..1], scene.bounds, 1000.0, true)
            .unwrap();
    }
    assert!(delayed.rebase(f64::NAN).is_err());
    assert!(delayed.rebase(999.0).is_err());
    delayed.rebase(10000.0).unwrap();
    for elapsed in [0.0, 150.0, 400.0, 800.0, 1300.0, 2500.0] {
        assert_eq!(
            delayed.advance(10000.0 + elapsed).unwrap(),
            reference.advance(1000.0 + elapsed).unwrap()
        );
        for index in 0..2 {
            assert!((delayed.opacity(index) - reference.opacity(index)).abs() < 1e-5);
        }
    }
}
