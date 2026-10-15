use anatomy_renderer::{Bounds, Camera};
use glam::Vec3;

#[test]
fn child_focus_uses_the_startup_canvas_center() {
    let body = Bounds {
        min: Vec3::new(-0.4, 0.0, -0.3),
        max: Vec3::new(0.4, 1.8, 0.3),
    };
    let part = Bounds {
        min: Vec3::new(0.1, 1.5, 0.0),
        max: Vec3::new(0.2, 1.6, 0.1),
    };
    let mut camera = Camera::new(body);
    for (width, height, frame) in [
        (1440, 900, [0.24, 0.13, 0.45, 0.76]),
        (390, 600, [0.03, 0.2, 0.94, 0.65]),
    ] {
        camera.resize(width, height);
        camera.focus(part, frame).unwrap();
        let projected = camera.matrix().project_point3(part.center());
        assert!(projected.x.abs() < 1e-5);
        assert!(
            (projected.y - 0.04).abs() < 1e-5,
            "Child focus must use the startup canvas center"
        );
        let distance = camera.distance;
        camera.reframe(frame).unwrap();
        assert_eq!(camera.distance, distance);
        let projected = camera.matrix().project_point3(part.center());
        assert!(projected.x.abs() < 1e-5 && (projected.y - 0.04).abs() < 1e-5);
    }
}

#[test]
fn full_viewport_focus_restores_startup_position_and_scale() {
    let body = Bounds {
        min: Vec3::new(-0.4, 0.0, -0.3),
        max: Vec3::new(0.4, 1.8, 0.3),
    };
    let part = Bounds {
        min: Vec3::new(0.1, 1.5, 0.0),
        max: Vec3::new(0.2, 1.6, 0.1),
    };
    let mut camera = Camera::new(body);
    for (width, height) in [(1440, 900), (390, 600)] {
        let mut startup = Camera::new(body);
        startup.resize(width, height);
        camera.resize(width, height);
        camera.focus(part, [0.24, 0.13, 0.45, 0.76]).unwrap();
        camera.pan(0.1, -0.1).unwrap();
        camera.rotate(0.5, -0.3).unwrap();
        camera.zoom(0.5).unwrap();
        camera.focus(body, [0.0, 0.0, 1.0, 1.0]).unwrap();
        for (actual, expected) in camera
            .matrix()
            .to_cols_array()
            .into_iter()
            .zip(startup.matrix().to_cols_array())
        {
            assert!(
                (actual - expected).abs() < 1e-5,
                "General framing must restore the exact startup camera"
            );
        }
        camera.reframe([0.24, 0.13, 0.45, 0.76]).unwrap();
        assert_eq!(camera.matrix(), startup.matrix());
    }
}

#[test]
fn system_focus_keeps_at_least_the_startup_scale_after_resize() {
    let body = Bounds {
        min: Vec3::new(-0.4, 0.0, -0.3),
        max: Vec3::new(0.4, 1.8, 0.3),
    };
    for bounds in [
        body,
        Bounds {
            min: body.min + Vec3::splat(0.01),
            max: body.max - Vec3::splat(0.01),
        },
    ] {
        let mut camera = Camera::new(body);
        for (width, height, frame) in [
            (1440, 900, [0.24, 0.13, 0.45, 0.76]),
            (390, 600, [0.03, 0.2, 0.94, 0.65]),
        ] {
            let mut startup = Camera::new(body);
            startup.resize(width, height);
            camera.resize(width, height);
            camera.zoom(0.5).unwrap();
            camera.focus(bounds, frame).unwrap();
            assert!(
                (camera.distance - startup.distance).abs() < 1e-5,
                "System focus must match the initial full-body scale"
            );
            assert_eq!(camera.target, bounds.center());
            camera.reset();
            camera.reframe(frame).unwrap();
            assert!((camera.distance - startup.distance).abs() < 1e-5);
        }
    }
}

#[test]
fn focus_frames_small_geometry_between_panels_and_after_resize() {
    let body = Bounds {
        min: Vec3::new(-0.4, 0.0, -0.3),
        max: Vec3::new(0.4, 1.8, 0.3),
    };
    let check_frame = |camera: &Camera, bounds: Bounds, frame: [f32; 4]| {
        let [_, _, width, height] = frame;
        let left = (1.0 - width) * 0.5;
        let top = 0.48 - height * 0.5;
        for x in [bounds.min.x, bounds.max.x] {
            for y in [bounds.min.y, bounds.max.y] {
                for z in [bounds.min.z, bounds.max.z] {
                    let point = camera.matrix().project_point3(Vec3::new(x, y, z));
                    let u = (point.x + 1.0) / 2.0;
                    let v = (1.0 - point.y) / 2.0;
                    assert!(u >= left - 1e-4 && u <= left + width + 1e-4);
                    assert!(v >= top - 1e-4 && v <= top + height + 1e-4);
                    assert!(point.z.abs() <= 1.0);
                }
            }
        }
    };
    for radius in [0.01, 0.0001] {
        let bounds = Bounds {
            min: Vec3::new(0.1, 1.7, 0.0) - Vec3::splat(radius),
            max: Vec3::new(0.1, 1.7, 0.0) + Vec3::splat(radius),
        };
        let mut camera = Camera::new(body);
        camera.resize(1440, 900);
        let initial_distance = camera.distance;
        let desktop = [0.24, 0.13, 0.45, 0.76];
        camera.focus(bounds, desktop).unwrap();
        assert_eq!(camera.target, bounds.center());
        assert!(camera.distance < initial_distance);
        check_frame(&camera, bounds, desktop);
        camera.resize(390, 600);
        let mobile = [0.03, 0.2, 0.94, 0.65];
        camera.reframe(mobile).unwrap();
        check_frame(&camera, bounds, mobile);
        let previous_target = camera.target;
        let previous_distance = camera.distance;
        for invalid in [
            [0.0, 0.0, 0.0, 1.0],
            [-0.1, 0.0, 1.0, 1.0],
            [0.1, 0.0, 1.0, 1.0],
            [0.0, 0.0, f32::NAN, 1.0],
        ] {
            assert!(camera.focus(body, invalid).is_err());
            assert_eq!(camera.target, previous_target);
            assert_eq!(camera.distance, previous_distance);
        }
    }
}

#[test]
fn shadow_projection_covers_anatomy_and_orders_occluders() {
    for bounds in [
        Bounds {
            min: Vec3::new(-0.4, -0.9, -0.2),
            max: Vec3::new(0.4, 0.9, 0.2),
        },
        Bounds {
            min: Vec3::ZERO,
            max: Vec3::ZERO,
        },
    ] {
        for (yaw, pitch) in [(0.0, 0.0), (std::f32::consts::PI, 1.55), (2.0, -1.55)] {
            let mut camera = Camera::new(bounds);
            camera.yaw = yaw;
            camera.pitch = pitch;
            let light = camera.light_basis() * Vec3::new(std::f32::consts::FRAC_1_SQRT_2, 0.5, 0.5);
            let matrix = bounds.shadow_matrix(light);
            assert!(matrix.is_finite());
            for x in [bounds.min.x, bounds.max.x] {
                for y in [bounds.min.y, bounds.max.y] {
                    for z in [bounds.min.z, bounds.max.z] {
                        assert!(
                            matrix
                                .project_point3(Vec3::new(x, y, z))
                                .abs()
                                .max_element()
                                <= 1.0
                        );
                    }
                }
            }
            let front = matrix.project_point3(bounds.center() + light * 0.0001);
            let back = matrix.project_point3(bounds.center());
            assert!(front.z < back.z);
        }
    }
}

#[test]
fn lights_follow_camera_orbit_and_ignore_pan_and_zoom() {
    let mut camera = Camera::new(Bounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
    });
    for (yaw, pitch) in [(0.0, 0.0), (std::f32::consts::PI, 1.4), (2.0, -2.8)] {
        camera.rotate(yaw, pitch).unwrap();
        let basis = camera.light_basis();
        assert!((basis.z_axis - (camera.eye() - camera.target).normalize()).length() < 1e-5);
        assert!((basis.determinant() - 1.0).abs() < 1e-5);
        camera.pan(0.1, -0.1).unwrap();
        camera.zoom(0.8).unwrap();
        assert_eq!(camera.light_basis(), basis);
    }
}

#[test]
fn camera_stays_ten_percent_inside_the_fixed_enclosure() {
    let bounds = Bounds {
        min: Vec3::new(-0.4, 0.0, -0.3),
        max: Vec3::new(0.4, 1.8, 0.3),
    };
    let mut camera = Camera::new(bounds);
    let limit = camera.enclosure_radius() * 0.9;
    let check = |camera: &Camera| {
        assert!(camera.eye().is_finite());
        assert!(camera.matrix().is_finite());
        assert!(camera.eye().distance(bounds.center()) <= limit + limit * 1e-5);
    };
    camera.zoom(f32::MAX).unwrap();
    assert!((camera.eye().distance(bounds.center()) - limit).abs() < 1e-5);
    check(&camera);
    for (x, y) in [(100.0, -100.0), (-100.0, 100.0), (1e10, -1e10)] {
        camera.pan(x, y).unwrap();
        check(&camera);
        for pitch in [-3.0, 0.7, 3.0] {
            camera.rotate(1.2, pitch).unwrap();
            check(&camera);
            camera.zoom(100.0).unwrap();
            check(&camera);
            camera.zoom(0.001).unwrap();
            check(&camera);
        }
    }
    camera.zoom(f32::MAX).unwrap();
    let previous = camera.eye();
    assert!(camera.pan(f32::MAX, f32::MAX).is_err());
    assert_eq!(camera.eye(), previous);
    camera.resize(200, 1600);
    check(&camera);
    camera.reset();
    check(&camera);
    assert!(camera.target.distance(bounds.center()) < 1e-5);
}

#[test]
fn camera_fits_narrow_viewports_and_rejects_invalid_inputs() {
    let bounds = Bounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
    };
    let mut camera = Camera::new(bounds);
    let initial_yaw = camera.yaw;
    let initial_pitch = camera.pitch;
    let wide_distance = camera.distance;
    camera.resize(390, 480);
    assert!(camera.distance > wide_distance);
    camera.rotate(0.5, 100.0).unwrap();
    assert!(camera.matrix().is_finite());
    assert!(camera.zoom(0.0).is_err());
    assert!(camera.rotate(f32::NAN, 0.0).is_err());
    assert!(camera.pan(f32::INFINITY, 0.0).is_err());
    camera.reset();
    assert_eq!(camera.yaw, initial_yaw);
    assert_eq!(camera.pitch, initial_pitch);
    assert!(camera.eye().x < camera.target.x);
    assert!(camera.eye().y > camera.target.y);
    let check_frame = |camera: &Camera| {
        let center = camera.matrix().project_point3(camera.target);
        assert!(center.x.abs() < 1e-5);
        assert!((center.y - 0.04).abs() < 1e-5);
    };
    check_frame(&camera);
    camera.rotate(0.6, -0.3).unwrap();
    camera.zoom(0.8).unwrap();
    camera.pan(0.1, -0.2).unwrap();
    check_frame(&camera);
}
