use anatomy_wasm::HandGestureController;
use serde_json::Value;

fn hand(x: f32, pinching: bool) -> Vec<f32> {
    let mut points = [[x, 0.5, 0.0]; 21];
    points[0] = [x, 0.8, 0.0];
    points[4] = [x - 0.2, 0.4, 0.0];
    for base in [5, 9, 13, 17] {
        points[base + 1] = [x, 0.4, 0.0];
        points[base + 3] = [x, 0.2, 0.0];
    }
    if pinching {
        points[4] = [x - 0.01, 0.2, 0.0];
    }
    [vec![1.0, 0.99], points.into_iter().flatten().collect()].concat()
}

fn update(controller: &mut HandGestureController, time: f64, x: f32, pinching: bool) -> Value {
    serde_json::from_str(
        &controller
            .update_controls(&hand(x, pinching), time, 1.0, &[0.0, 0.0, 1.0, 1.0], true)
            .unwrap(),
    )
    .unwrap()
}

#[test]
fn suspended_controls_keep_live_hands_without_actions_and_require_release_on_resume() {
    let mut controller = HandGestureController::new();
    update(&mut controller, 0.0, 0.5, false);
    update(&mut controller, 40.0, 0.5, true);
    assert!(
        !update(&mut controller, 80.0, 0.52, true)["commands"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    controller.set_suspended(true);
    let first = update(&mut controller, 120.0, 0.54, true);
    let moved = update(&mut controller, 160.0, 0.56, true);
    assert_ne!(
        first["hands"][0]["landmarks"][8][0],
        moved["hands"][0]["landmarks"][8][0]
    );
    for time in (200..1160).step_by(40) {
        let result = update(&mut controller, time as f64, 0.56, false);
        assert_eq!(result["mode"], "paused");
        assert_eq!(result["hands"].as_array().unwrap().len(), 1);
        assert!(result["commands"].as_array().unwrap().is_empty());
        assert!(result.get("interface").is_none());
    }

    controller.set_suspended(false);
    for (time, x) in [(1160.0, 0.56), (1200.0, 0.57)] {
        let result = update(&mut controller, time, x, true);
        assert_eq!(result["mode"], "idle");
        assert_eq!(result["hands"][0]["state"], "release");
        assert!(result["commands"].as_array().unwrap().is_empty());
    }
    update(&mut controller, 1240.0, 0.57, false);
    update(&mut controller, 1280.0, 0.57, true);
    assert!(
        !update(&mut controller, 1320.0, 0.59, true)["commands"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn camera_disable_transitions_and_control_cancellation_preserve_landmark_smoothing() {
    let mut controller = HandGestureController::new();
    update(&mut controller, 0.0, 0.5, false);
    let before = update(&mut controller, 40.0, 0.54, false)["hands"][0]["landmarks"][0][0]
        .as_f64()
        .unwrap();
    let disabled: Value = serde_json::from_str(
        &controller
            .update_controls(&hand(0.56, false), 80.0, 1.0, &[0.0, 0.0, 1.0, 1.0], false)
            .unwrap(),
    )
    .unwrap();
    let during = disabled["hands"][0]["landmarks"][0][0].as_f64().unwrap();
    assert!(during > 0.44 && during < before);
    assert_eq!(disabled["mode"], "idle");
    assert!(disabled["commands"].as_array().unwrap().is_empty());
    controller.cancel_controls();
    let resumed = update(&mut controller, 120.0, 0.58, false)["hands"][0]["landmarks"][0][0]
        .as_f64()
        .unwrap();
    assert!(resumed > 0.42 && resumed < during);
    controller.set_suspended(true);
    let paused = update(&mut controller, 160.0, 0.6, false)["hands"][0]["landmarks"][0][0]
        .as_f64()
        .unwrap();
    assert!(paused > 0.4 && paused < resumed);
}
