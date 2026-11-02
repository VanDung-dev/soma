use glam::Vec3;
use renderer::{Bounds, Camera, Explosion, Primitive, Reconstruction, Scene, Separation};

fn scene() -> Scene {
    let part = |id: &str, min: [f32; 3], max: [f32; 3]| -> Primitive {
        serde_json::from_value(serde_json::json!({
            "source_id": id, "bounds": {"min": min, "max": max}, "color": [0.5,0.5,0.5,1.0],
            "roughness": 0.6, "metallic": 0.0, "specular": 0.04, "subsurface": 0.0,
            "double_sided": false, "blend": false, "alpha_cutoff": 0.0,
            "active": true, "visible": true
        }))
        .unwrap()
    };
    Scene {
        bounds: Bounds {
            min: Vec3::new(-1.0, 0.0, -0.2),
            max: Vec3::new(1.0, 2.0, 0.2),
        },
        selected: String::new(),
        parts: vec![
            part("a", [-1.0, 0.0, -0.2], [-0.5, 1.0, 0.2]),
            part("a", [-0.7, 0.1, -0.1], [-0.4, 0.9, 0.1]),
            part("b", [0.1, 0.0, -0.2], [1.0, 1.5, 0.2]),
            part("c", [-0.4, 1.4, -0.2], [0.1, 2.0, 0.2]),
        ],
    }
}

fn groups() -> Vec<Vec<String>> {
    vec![vec!["a".into()], vec!["b".into(), "c".into()]]
}

#[test]
fn overview_tracks_displayed_offsets_and_keeps_its_grid_around_the_camera() {
    let mut scene = scene();
    scene
        .change_visibility(&["a".into(), "b".into()], false)
        .unwrap();
    let mut explosion = Explosion::new(&scene, groups()).unwrap();
    explosion.layout(&scene, 1.0);
    let frame = [0.2, 0.1, 0.6, 0.7];
    let before = explosion.overview_camera(&scene, 1.5, frame).unwrap();
    explosion.set(0.3, 0.0).unwrap();
    explosion.layout(&scene, 1.0);
    let pending = explosion.overview_camera(&scene, 1.5, frame).unwrap();
    assert_eq!(pending.matrix(), before.matrix());
    explosion.advance(16.0, scene.bounds.radius()).unwrap();
    let moving = explosion.overview_camera(&scene, 1.5, frame).unwrap();
    let bounds = scene.parts[3].bounds.translated(explosion.offset(3));
    assert_eq!(moving.enclosure_center(), bounds.center());
    assert!(moving.eye().distance(moving.enclosure_center()) < moving.enclosure_radius());
    let point = moving.matrix().project_point3(bounds.center());
    assert!(point.x.abs() < 1e-5);
    assert!((point.y - 0.1).abs() < 1e-5);
    assert_ne!(moving.matrix(), before.matrix());
}

#[test]
fn selection_drag_preserves_relative_positions_and_rejects_invalid_members_atomically() {
    let mut scene = scene();
    let camera = Camera::new(scene.bounds);
    let mut separation = Separation::default();
    separation.set(&scene, "a", [0.2, 0.1, 0.0]).unwrap();
    separation.set(&scene, "b", [-0.1, 0.0, 0.3]).unwrap();
    let a = separation.offset("a");
    let b = separation.offset("b");
    let ids = vec!["a".into(), "b".into()];
    separation
        .drag_selection(&scene, &camera, &ids, "a", 0.1, -0.05)
        .unwrap();
    let delta = separation.offset("a") - a;
    assert!(delta.length() > 0.0);
    assert!((separation.offset("b") - b - delta).length() < 1e-6);
    assert_eq!(separation.offset("c"), Vec3::ZERO);
    let before = [separation.offset("a"), separation.offset("b")];
    for invalid in [vec!["a".into(), "unknown".into()], vec!["b".into()]] {
        assert!(
            separation
                .drag_selection(&scene, &camera, &invalid, "a", 0.1, 0.0)
                .is_err()
        );
        assert_eq!(before, [separation.offset("a"), separation.offset("b")]);
    }
    assert!(
        separation
            .drag_selection(&scene, &camera, &ids, "a", f32::NAN, 0.0)
            .is_err()
    );
    separation
        .drag_selection(&scene, &camera, &ids, "a", 1e10, 0.0)
        .unwrap();
    assert_eq!(before, [separation.offset("a"), separation.offset("b")]);
    scene.change_visibility(&["b".into()], false).unwrap();
    assert!(
        separation
            .drag_selection(&scene, &camera, &ids, "a", 0.1, 0.0)
            .is_err()
    );
    assert_eq!(before, [separation.offset("a"), separation.offset("b")]);
}

#[test]
fn manual_separation_preserves_structure_identity_camera_and_original_geometry() {
    let scene = scene();
    let mut camera = Camera::new(scene.bounds);
    camera.resize(1400, 900);
    camera.rotate(0.7, -0.2).unwrap();
    camera.pan(0.12, -0.08).unwrap();
    let matrix = camera.matrix();
    let original = scene.bounds_for(&["a".into()]).unwrap().unwrap();
    let before = matrix.project_point3(original.center());
    let mut separated = Separation::default();
    separated.drag(&scene, &camera, "a", 0.08, -0.04).unwrap();
    let offset = separated.offset("a");
    let after = matrix.project_point3(original.center() + offset);
    assert!((after.x - before.x - 0.16).abs() < 1e-4);
    assert!((after.y - before.y - 0.08).abs() < 1e-4);
    assert_eq!(camera.matrix(), matrix);
    assert_eq!(scene.parts[0].bounds.min, Vec3::new(-1.0, 0.0, -0.2));
    assert_eq!(
        separated.offset(&scene.parts[0].source_id),
        separated.offset(&scene.parts[1].source_id)
    );
    assert_eq!(separated.offset("b"), Vec3::ZERO);
    assert!(separated.set(&scene, "missing", [0.0; 3]).is_err());
    assert!(separated.set(&scene, "a", [f32::NAN, 0.0, 0.0]).is_err());
    assert!(
        separated
            .drag(&scene, &camera, "a", f32::INFINITY, 0.0)
            .is_err()
    );
    assert_eq!(separated.offset("a"), offset);
    separated.set(&scene, "b", [0.1, 0.0, 0.0]).unwrap();
    separated.clear("a");
    assert!(!separated.moved("a"));
    assert!(separated.moved("b"));
    separated.clear("");
    assert!(separated.is_empty());
}

#[test]
fn fading_systems_keep_their_separated_positions_until_they_disappear() {
    let mut scene = scene();
    let mut reveal = Reconstruction::default();
    reveal
        .append(&scene.parts, scene.bounds, 0.0, false)
        .unwrap();
    let mut explosion = Explosion::new(&scene, groups()).unwrap();
    explosion.set(0.3, 0.0).unwrap();
    explosion.layout(&scene, 1.0);
    explosion.finish();
    let before = explosion.offset(0);
    scene.change_visibility(&["a".into()], false).unwrap();
    reveal.set_visibility(&scene.parts, Some(100.0)).unwrap();
    explosion.layout_revealed(&scene, 1.0, &reveal);
    explosion.finish();
    assert_eq!(
        explosion.offset(0),
        before,
        "Fading tissue must stay in its depth layer"
    );
    reveal.finish();
    explosion.layout_revealed(&scene, 1.0, &reveal);
    explosion.finish();
    assert_eq!(explosion.offset(0), Vec3::ZERO);
}

#[test]
fn thirty_percent_separates_all_nine_layers_and_fits_the_panel_space() {
    let mut scene = scene();
    scene.parts = (0..9)
        .map(|i| {
            let mut part: Primitive =
                serde_json::from_value(serde_json::to_value(&scene.parts[0]).unwrap()).unwrap();
            part.source_id = i.to_string();
            part.bounds = scene.bounds;
            part
        })
        .collect();
    let groups = (0..9).map(|i| vec![i.to_string()]).collect();
    let mut explosion = Explosion::new(&scene, groups).unwrap();
    explosion.set(0.3, 0.0).unwrap();
    explosion.layout(&scene, 1.0);
    explosion.finish();
    let layers: Vec<_> = (0..9)
        .map(|i| scene.bounds.translated(explosion.offset(i)))
        .collect();
    for pair in layers.windows(2) {
        assert!(
            ((pair[1].min.x - pair[0].min.x) - (scene.bounds.max.x - scene.bounds.min.x) * 0.5)
                .abs()
                < 1e-6,
            "Stagger each system by half the body width"
        );
        assert!(
            pair[0].max.z < pair[1].min.z,
            "Separate every depth layer from above"
        );
        assert_eq!(pair[0].min.y, pair[1].min.y, "Keep the anatomical height");
    }
    for aspect in [0.65, 1.6] {
        let frame = [0.27, 0.12, 0.46, 0.65];
        let camera = explosion.overview_camera(&scene, aspect, frame).unwrap();
        assert!(camera.distance > Camera::new(scene.bounds).distance);
        let mut min = Vec3::splat(f32::INFINITY);
        let mut max = Vec3::splat(f32::NEG_INFINITY);
        for layer in &layers {
            for x in [layer.min.x, layer.max.x] {
                for y in [layer.min.y, layer.max.y] {
                    for z in [layer.min.z, layer.max.z] {
                        let point = camera.matrix().project_point3(Vec3::new(x, y, z));
                        let u = (point.x + 1.0) * 0.5;
                        let v = (1.0 - point.y) * 0.5;
                        min = min.min(Vec3::new(u, v, 0.0));
                        max = max.max(Vec3::new(u, v, 0.0));
                        assert!(u >= frame[0] && u <= frame[0] + frame[2]);
                        assert!(v >= frame[1] && v <= frame[1] + frame[3]);
                    }
                }
            }
        }
        let center = (min + max) * 0.5;
        assert!(
            (center.x - (frame[0] + frame[2] * 0.5)).abs() < 1e-5,
            "The visible staircase must have equal left and right margins: {center:?}"
        );
        assert!((center.y - (frame[1] + frame[3] * 0.5)).abs() < 1e-5);
    }
}

#[test]
fn stages_preserve_systems_then_expand_before_arranging() {
    let scene = scene();
    let mut explosion = Explosion::new(&scene, groups()).unwrap();
    for amount in [0.01, 0.15, 0.3] {
        explosion.set(amount, 0.0).unwrap();
        explosion.layout(&scene, 1.0);
        explosion.finish();
        assert_eq!(explosion.offset(0), explosion.offset(1));
        assert_eq!(
            explosion.offset(2),
            explosion.offset(3),
            "Keep each system intact through 30%"
        );
        assert_ne!(explosion.offset(0), explosion.offset(2));
    }
    for amount in [0.31, 0.45, 0.6] {
        explosion.set(amount, 0.0).unwrap();
        explosion.layout(&scene, 0.5);
        explosion.finish();
        let offsets: Vec<_> = (0..scene.parts.len())
            .map(|i| explosion.offset(i))
            .collect();
        assert_ne!(
            offsets[2], offsets[3],
            "Individual structures expand after 30%"
        );
        explosion.layout(&scene, 1.5);
        explosion.finish();
        for (i, expected) in offsets.into_iter().enumerate() {
            assert_eq!(
                explosion.offset(i),
                expected,
                "Do not arrange into rows before 60%"
            );
        }
    }
    for boundary in [0.3, 0.6] {
        explosion.set(boundary, 0.0).unwrap();
        explosion.layout(&scene, 1.0);
        explosion.finish();
        let before: Vec<_> = (0..scene.parts.len())
            .map(|i| explosion.offset(i))
            .collect();
        explosion.set(boundary + 0.0001, 0.0).unwrap();
        explosion.layout(&scene, 1.0);
        explosion.finish();
        for (i, offset) in before.into_iter().enumerate() {
            assert!(
                explosion.offset(i).distance(offset) < scene.bounds.radius() * 0.01,
                "Stage boundaries must not jump"
            );
        }
    }
    explosion.set(1.0, 0.0).unwrap();
    explosion.layout(&scene, 1.0);
    explosion.finish();
    let separated = explosion.offset(0);
    explosion.set(0.0, 0.0).unwrap();
    explosion.layout(&scene, 1.0);
    assert_eq!(
        explosion.offset(0),
        separated,
        "Returning to zero must not snap"
    );
    assert!(explosion.advance(16.0, scene.bounds.radius()).unwrap().0);
    assert!(explosion.offset(0).length() < separated.length());
    for frame in 2..150 {
        explosion
            .advance(frame as f64 * 16.0, scene.bounds.radius())
            .unwrap();
    }
    for i in 0..scene.parts.len() {
        assert_eq!(explosion.offset(i), Vec3::ZERO);
    }
}

#[test]
fn packs_structures_without_splitting_materials_and_restores_assembled_positions() {
    let mut scene = scene();
    for aspect in [0.5, 1.0, 1.5] {
        let mut explosion = Explosion::new(&scene, groups()).unwrap();
        explosion.set(1.0, 0.0).unwrap();
        let bounds = explosion.layout(&scene, aspect);
        explosion.finish();
        assert_eq!(explosion.offset(0), explosion.offset(1));
        let displayed: Vec<_> = [vec![0, 1], vec![2], vec![3]]
            .map(|indices| {
                indices
                    .into_iter()
                    .map(|i| scene.parts[i].bounds.translated(explosion.offset(i)))
                    .reduce(Bounds::union)
                    .unwrap()
            })
            .into();
        for (i, a) in displayed.iter().enumerate() {
            assert!((a.center().z - scene.bounds.center().z).abs() < 1e-6);
            assert!(a.min.cmpge(bounds.min - Vec3::splat(1e-6)).all());
            assert!(a.max.cmple(bounds.max + Vec3::splat(1e-6)).all());
            for b in &displayed[i + 1..] {
                assert!(
                    a.max.x <= b.min.x
                        || b.max.x <= a.min.x
                        || a.max.y <= b.min.y
                        || b.max.y <= a.min.y
                );
            }
        }
        explosion.set(0.0, 1.0).unwrap();
        explosion.layout(&scene, aspect);
        explosion.finish();
        for i in 0..scene.parts.len() {
            assert_eq!(explosion.offset(i), Vec3::ZERO);
        }
        scene.change_visibility(&["b".into()], false).unwrap();
        explosion.set(1.0, 2.0).unwrap();
        explosion.layout(&scene, aspect);
        explosion.finish();
        assert_eq!(explosion.offset(2), Vec3::ZERO);
        scene.set_visibility(&[]).unwrap();
        let empty = explosion.layout(&scene, aspect);
        assert!(empty.radius().is_finite());
        assert!(
            explosion
                .overview_camera(&scene, aspect, [0.0, 0.0, 1.0, 1.0])
                .unwrap()
                .matrix()
                .is_finite()
        );
        scene
            .set_visibility(&["a".into(), "b".into(), "c".into()])
            .unwrap();
    }
}

#[test]
fn animates_retargets_without_jumping_and_rejects_invalid_input() {
    let scene = scene();
    let mut explosion = Explosion::new(&scene, groups()).unwrap();
    for value in [f32::NAN, f32::INFINITY, -0.1, 1.1] {
        assert!(explosion.set(value, 0.0).is_err());
    }
    assert!(explosion.set(1.0, f64::NAN).is_err());
    assert!(Explosion::new(&scene, vec![vec!["a".into()]]).is_err());
    assert!(Explosion::new(&scene, vec![vec!["a".into(), "a".into()]]).is_err());
    assert!(Explosion::new(&scene, vec![vec!["unknown".into()]]).is_err());
    explosion.set(1.0, 0.0).unwrap();
    explosion.layout(&scene, 1.0);
    let (moving, _) = explosion.advance(16.0, scene.bounds.radius()).unwrap();
    assert!(moving && explosion.offset(0) != Vec3::ZERO);
    let displayed = explosion.displayed_amount();
    assert!(displayed > 0.0 && displayed < explosion.amount());
    let previous = explosion.offset(0);
    explosion.set(0.3, 16.0).unwrap();
    explosion.layout(&scene, 1.0);
    assert_eq!(explosion.offset(0), previous);
    assert_eq!(explosion.displayed_amount(), displayed);
    assert!(explosion.advance(15.0, scene.bounds.radius()).is_err());
    let mut moving = true;
    for frame in 2..150 {
        moving = explosion
            .advance(frame as f64 * 16.0, scene.bounds.radius())
            .unwrap()
            .0;
    }
    assert!(!moving);
    assert_eq!(explosion.displayed_amount(), 0.3);
    explosion.set(0.0, 2400.0).unwrap();
    explosion.layout(&scene, 1.0);
    explosion.advance(2416.0, scene.bounds.radius()).unwrap();
    assert!(explosion.displayed_amount() > 0.0 && explosion.displayed_amount() < 0.3);
    explosion.finish();
    assert_eq!(explosion.displayed_amount(), 0.0);
    explosion.clear();
    assert_eq!(explosion.offset(0), Vec3::ZERO);
}

#[test]
fn inventory_camera_fits_the_available_viewport_and_remains_controllable() {
    let bounds = Bounds {
        min: Vec3::new(-5.0, -3.0, -0.5),
        max: Vec3::new(5.0, 3.0, 0.5),
    };
    let mut camera = Camera::layout(bounds, 1.6, [0.3, 0.2, 0.4, 0.6]).unwrap();
    assert!(
        camera
            .matrix()
            .project_point3(bounds.center())
            .truncate()
            .length()
            < 1e-5
    );
    for x in [bounds.min.x, bounds.max.x] {
        for y in [bounds.min.y, bounds.max.y] {
            for z in [bounds.min.z, bounds.max.z] {
                let point = camera.matrix().project_point3(Vec3::new(x, y, z));
                assert!(point.x.abs() < 0.4 && (point.y - 0.04).abs() < 0.6);
            }
        }
    }
    let distance = camera.distance;
    camera.zoom(1.01).unwrap();
    assert!((camera.distance / distance - 1.01).abs() < 1e-5);
    camera.pan(0.01, 0.01).unwrap();
    camera.rotate(0.1, 0.1).unwrap();
    assert!(camera.matrix().is_finite());
    assert!(Camera::layout(bounds, 1.0, [0.0, 0.0, 0.0, 1.0]).is_err());
}

#[test]
fn inventory_framing_uses_the_panel_space_without_clipping() {
    for (size, aspect, frame) in [
        (Vec3::new(18.0, 10.0, 0.8), 1.6, [0.27, 0.12, 0.46, 0.65]),
        (Vec3::new(4.0, 15.0, 1.0), 1.6, [0.3, 0.2, 0.4, 0.6]),
        (Vec3::new(18.0, 10.0, 0.8), 0.65, [0.03, 0.2, 0.94, 0.65]),
        (Vec3::new(3.0, 2.0, 4.0), 2.0, [0.2, 0.1, 0.5, 0.7]),
    ] {
        let center = Vec3::new(1.0, 2.0, -0.3);
        let bounds = Bounds {
            min: center - size * 0.5,
            max: center + size * 0.5,
        };
        let camera = Camera::layout(bounds, aspect, frame).unwrap();
        let mut min = Vec3::splat(f32::INFINITY);
        let mut max = Vec3::splat(f32::NEG_INFINITY);
        for x in [bounds.min.x, bounds.max.x] {
            for y in [bounds.min.y, bounds.max.y] {
                for z in [bounds.min.z, bounds.max.z] {
                    let point = camera.matrix().project_point3(Vec3::new(x, y, z));
                    let uv = Vec3::new((point.x + 1.0) * 0.5, (1.0 - point.y) * 0.5, point.z);
                    assert!(uv.x >= frame[0] && uv.x <= frame[0] + frame[2]);
                    assert!(uv.y >= frame[1] && uv.y <= frame[1] + frame[3]);
                    assert!(uv.z.abs() <= 1.0);
                    min = min.min(uv);
                    max = max.max(uv);
                }
            }
        }
        let coverage = ((max.x - min.x) / frame[2]).max((max.y - min.y) / frame[3]);
        assert!(
            coverage > 0.88 && coverage < 0.91,
            "Inventory must fill its limiting dimension: {coverage}"
        );
    }
}
