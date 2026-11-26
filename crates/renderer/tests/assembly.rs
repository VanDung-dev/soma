use glam::Vec3;
use renderer::{Camera, Scene, Separation};

fn scene() -> Scene {
    let parts: Vec<_> = [
        ("a", 0.0),
        ("b", 0.3),
        ("c", 0.6),
        ("d", 0.9),
        ("remote", 3.0),
    ]
    .into_iter()
    .map(|(id, x)| {
        serde_json::json!({
            "source_id": id, "bounds": {"min": [x, 0.0, 0.0], "max": [x + 0.3, 0.3, 0.3]},
            "color": [0.5, 0.5, 0.5, 1.0], "roughness": 0.6, "metallic": 0.0,
            "specular": 0.04, "subsurface": 0.0, "double_sided": false,
            "blend": false, "alpha_cutoff": 0.0, "active": true, "visible": true
        })
    })
    .collect();
    serde_json::from_value(serde_json::json!({
        "parts": parts, "bounds": {"min": [0.0, 0.0, 0.0], "max": [3.3, 0.3, 0.3]}, "selected": "a"
    }))
    .unwrap()
}

#[test]
fn only_visible_original_neighbors_with_matching_relative_positions_are_suggested() {
    let mut scene = scene();
    let mut separation = Separation::default();
    separation.set(&scene, "a", [0.5, 0.02, 0.0]).unwrap();
    separation.set(&scene, "b", [0.5, 0.0, 0.0]).unwrap();
    separation.set(&scene, "remote", [0.5, 0.02, 0.0]).unwrap();
    assert_eq!(
        separation.candidate(&scene, "a", 0.04).as_deref(),
        Some("b")
    );
    assert_eq!(separation.candidate(&scene, "remote", 0.04), None);
    scene.parts[1].visible = false;
    assert_eq!(separation.candidate(&scene, "a", 0.04), None);
    scene.parts[1].visible = true;
    scene.parts[1].active = false;
    assert_eq!(separation.candidate(&scene, "a", 0.04), None);
    scene.parts[1].active = true;
    separation.set(&scene, "a", [0.5, 0.0, 0.2]).unwrap();
    assert_eq!(separation.candidate(&scene, "a", 0.04), None);
    assert_eq!(separation.candidate(&scene, "missing", 0.04), None);
    for tolerance in [0.0, -1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(separation.candidate(&scene, "b", tolerance), None);
    }
}

#[test]
fn snapping_merges_groups_and_dragging_either_member_preserves_the_assembly() {
    let scene = scene();
    let original = serde_json::to_value(&scene).unwrap();
    let mut camera = Camera::new(scene.bounds);
    camera.resize(1200, 800);
    let matrix = camera.matrix();
    let mut separation = Separation::default();
    for (id, x) in [("a", 0.51), ("b", 0.5), ("c", 0.81), ("d", 0.8)] {
        separation.set(&scene, id, [x, 0.0, 0.0]).unwrap();
    }
    separation.snap(&scene, "a", "b", 0.04).unwrap();
    separation.snap(&scene, "c", "d", 0.04).unwrap();
    assert_eq!(separation.members("a"), ["a", "b"]);
    assert_eq!(separation.offset("a"), separation.offset("b"));
    separation.set(&scene, "d", [0.52, 0.0, 0.0]).unwrap();
    assert_eq!(
        separation.candidate(&scene, "a", 0.04).as_deref(),
        Some("c")
    );
    separation.snap(&scene, "a", "c", 0.04).unwrap();
    assert_eq!(separation.members("d"), ["a", "b", "c", "d"]);
    let before = separation.offset("a");
    separation.begin_drag("b", None);
    assert_eq!(separation.active_drag(), Some(("b", false)));
    separation.move_drag(&scene, &camera, 0.05, -0.02).unwrap();
    assert_ne!(separation.offset("a"), before);
    for id in ["b", "c", "d"] {
        assert_eq!(separation.offset(id), separation.offset("a"));
    }
    assert_eq!(separation.offset("remote"), Vec3::ZERO);
    separation.end_drag(true);
    for id in ["a", "b", "c", "d"] {
        assert_eq!(separation.offset(id), before);
    }
    assert_eq!(separation.members("d"), ["a", "b", "c", "d"]);
    assert_eq!(separation.active_drag(), None);
    assert_eq!(camera.matrix(), matrix);
    assert_eq!(serde_json::to_value(&scene).unwrap(), original);
}

#[test]
fn selection_rollback_restores_each_offset_and_cannot_replay_a_finished_drag() {
    let scene = scene();
    let camera = Camera::new(scene.bounds);
    let mut separation = Separation::default();
    let ids = vec!["a".into(), "b".into()];
    let before = Vec3::new(0.3, 0.0, 0.0);
    separation.set(&scene, "a", before.to_array()).unwrap();
    separation.begin_drag("a", Some(ids.clone()));
    assert_eq!(separation.active_drag(), Some(("a", true)));
    separation.move_drag(&scene, &camera, 0.05, 0.0).unwrap();
    assert_ne!(separation.offset("a"), before);
    assert_ne!(separation.offset("b"), Vec3::ZERO);
    separation.end_drag(true);
    assert_eq!(separation.offset("a"), before);
    assert_eq!(separation.offset("b"), Vec3::ZERO);

    separation.begin_drag("a", Some(ids.clone()));
    separation.move_drag(&scene, &camera, 0.05, 0.0).unwrap();
    separation.end_drag(false);
    let dropped = separation.offset("a");
    separation.end_drag(true);
    assert_eq!(separation.offset("a"), dropped);
    assert_ne!(dropped, before);

    separation.begin_drag("a", Some(ids));
    assert_eq!(
        separation
            .begin_restore_for(&scene, "a", 100.0, false, "b")
            .unwrap()
            .1,
        Some(false)
    );
    separation.end_drag(true);
    assert_eq!(separation.offset("a"), Vec3::ZERO);
    assert_ne!(separation.offset("b"), Vec3::ZERO);
}

#[test]
fn detach_preserves_positions_and_group_rollback_restore_and_body_attachment_are_complete() {
    let scene = scene();
    let mut separation = Separation::default();
    separation.set(&scene, "a", [0.5, 0.0, 0.0]).unwrap();
    separation.set(&scene, "b", [0.51, 0.0, 0.0]).unwrap();
    separation.snap(&scene, "b", "a", 0.04).unwrap();
    let before = separation.offset("a");
    separation.set(&scene, "b", [0.7, 0.0, 0.0]).unwrap();
    separation.set(&scene, "b", before.to_array()).unwrap();
    assert_eq!(separation.offset("a"), before);
    separation.detach("a");
    assert_eq!(separation.members("a"), ["a"]);
    assert_eq!(separation.offset("a"), before);
    separation.set(&scene, "a", [0.01, 0.0, 0.0]).unwrap();
    assert_eq!(separation.offset("b"), before);
    separation.set(&scene, "b", [0.01, 0.0, 0.0]).unwrap();
    separation.snap(&scene, "a", "b", 0.04).unwrap();
    separation.snap(&scene, "a", "c", 0.04).unwrap();
    assert!(separation.is_empty());
    assert_eq!(separation.members("a"), ["a"]);
    assert_eq!(separation.members("b"), ["b"]);
    separation.set(&scene, "a", [0.5, 0.0, 0.0]).unwrap();
    separation.set(&scene, "b", [0.5, 0.0, 0.0]).unwrap();
    separation.snap(&scene, "a", "b", 0.04).unwrap();
    separation.clear("b");
    assert!(separation.is_empty());
    assert_eq!(separation.members("a"), ["a"]);
}

#[test]
fn invalid_or_changed_targets_never_commit_or_modify_offsets() {
    let mut scene = scene();
    let mut separation = Separation::default();
    separation.set(&scene, "a", [0.5, 0.0, 0.0]).unwrap();
    separation.set(&scene, "b", [0.51, 0.0, 0.0]).unwrap();
    let before = separation.offset("a");
    assert!(separation.snap(&scene, "a", "remote", 0.04).is_err());
    scene.parts[1].visible = false;
    assert!(separation.snap(&scene, "a", "b", 0.04).is_err());
    assert_eq!(separation.offset("a"), before);
    assert_eq!(separation.members("a"), ["a"]);
    separation.clear("");
    assert!(separation.separated_ids().is_empty());
}

#[test]
fn restoration_interpolates_groups_and_finishes_at_exact_source_positions() {
    let scene = scene();
    let original = serde_json::to_value(&scene).unwrap();
    let mut separation = Separation::default();
    separation.set(&scene, "a", [0.8, 0.4, -0.2]).unwrap();
    separation.set(&scene, "b", [0.8, 0.4, -0.2]).unwrap();
    separation.snap(&scene, "a", "b", 0.04).unwrap();
    separation.set(&scene, "remote", [0.5, 0.0, 0.0]).unwrap();
    assert_eq!(
        separation.begin_restore(&scene, "b", 100.0, true).unwrap(),
        ["a", "b"]
    );
    assert!(separation.restoring());
    assert!(separation.advance_restore(100.0).unwrap());
    assert_eq!(separation.offset("a"), Vec3::new(0.8, 0.4, -0.2));
    assert!(separation.advance_restore(310.0).unwrap());
    assert_eq!(separation.offset("a"), Vec3::new(0.1, 0.05, -0.025));
    assert_eq!(separation.offset("a"), separation.offset("b"));
    assert_eq!(separation.members("a"), ["a", "b"]);
    assert_eq!(
        separation.advance_restore_for(520.0, "a").unwrap(),
        Some(true)
    );
    assert!(!separation.restoring());
    assert_eq!(separation.offset("a"), Vec3::ZERO);
    assert_eq!(separation.offset("b"), Vec3::ZERO);
    assert_eq!(separation.members("a"), ["a"]);
    assert_eq!(separation.separated_ids(), ["remote"]);
    assert_eq!(serde_json::to_value(&scene).unwrap(), original);
}

#[test]
fn restoration_restarts_from_displayed_offsets_and_merges_pending_targets() {
    let scene = scene();
    let mut separation = Separation::default();
    separation.set(&scene, "a", [0.8, 0.0, 0.0]).unwrap();
    separation.set(&scene, "b", [0.4, 0.0, 0.0]).unwrap();
    separation.begin_restore(&scene, "a", 0.0, true).unwrap();
    separation.advance_restore(210.0).unwrap();
    let displayed = separation.offset("a");
    assert_eq!(
        separation.begin_restore(&scene, "b", 210.0, true).unwrap(),
        ["a", "b"]
    );
    separation.advance_restore(210.0).unwrap();
    assert_eq!(separation.offset("a"), displayed);
    assert_eq!(separation.offset("b"), Vec3::new(0.4, 0.0, 0.0));
    separation.set(&scene, "remote", [0.5, 0.0, 0.0]).unwrap();
    assert!(!separation.restoring());
    assert_eq!(
        separation.begin_restore(&scene, "", 300.0, true).unwrap(),
        ["a", "b", "remote"]
    );
    separation.begin_restore(&scene, "a", 310.0, true).unwrap();
    separation.finish_restore();
    assert!(separation.is_empty());
    assert!(!separation.restoring());
    assert!(!separation.advance_restore(1000.0).unwrap());
}

#[test]
fn restoration_handles_reduced_motion_zero_offsets_and_interruption() {
    let scene = scene();
    let mut separation = Separation::default();
    assert_eq!(
        separation.begin_restore(&scene, "a", 0.0, true).unwrap(),
        ["a"]
    );
    assert!(!separation.restoring());
    separation.set(&scene, "a", [0.8, 0.0, 0.0]).unwrap();
    separation.begin_restore(&scene, "a", 0.0, false).unwrap();
    assert!(!separation.restoring());
    assert!(separation.is_empty());
    separation.set(&scene, "a", [0.8, 0.0, 0.0]).unwrap();
    separation.begin_restore(&scene, "", 0.0, true).unwrap();
    separation.advance_restore(100.0).unwrap();
    separation.clear("");
    assert!(!separation.advance_restore(210.0).unwrap());
    assert!(separation.is_empty());
}

#[test]
fn invalid_restoration_requests_preserve_positions_and_pending_animation() {
    let scene = scene();
    let mut separation = Separation::default();
    separation.set(&scene, "a", [0.8, 0.0, 0.0]).unwrap();
    separation.begin_restore(&scene, "a", 100.0, true).unwrap();
    separation.advance_restore(150.0).unwrap();
    let before = separation.offset("a");
    for now in [f64::NAN, f64::INFINITY, -1.0, 149.0] {
        assert!(separation.begin_restore(&scene, "b", now, true).is_err());
        assert!(separation.advance_restore(now).is_err());
        assert_eq!(separation.offset("a"), before);
        assert!(separation.restoring());
    }
    assert!(
        separation
            .begin_restore(&scene, "missing", 150.0, true)
            .is_err()
    );
    assert_eq!(separation.offset("a"), before);
    separation.advance_restore(520.0).unwrap();
    assert!(separation.is_empty());
}
