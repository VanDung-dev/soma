use anatomy_renderer::{Bounds, Camera};
use glam::Vec3;

#[test]
fn explosion_tracking_contains_then_centers_the_moving_selection() {
    let body = Bounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
    };
    for (width, height, frame) in [
        (1440, 900, [0.3, 0.12, 0.4, 0.68]),
        (390, 600, [0.03, 0.18, 0.94, 0.58]),
    ] {
        let mut original = Camera::new(body);
        original.resize(width, height);
        original.rotate(0.7, -0.3).unwrap();
        original.pan(0.6, -0.7).unwrap();
        original.zoom(0.1).unwrap();
        for offset in [Vec3::new(0.4, 0.8, 0.0), Vec3::new(-3.0, -4.0, 6.0)] {
            let bounds = Bounds {
                min: offset - Vec3::splat(0.1),
                max: offset + Vec3::splat(0.1),
            };
            for centered in [false, true] {
                let mut camera = original.clone();
                camera.contain(bounds, frame, centered).unwrap();
                assert_eq!(camera.light_basis(), original.light_basis());
                for x in [bounds.min.x, bounds.max.x] {
                    for y in [bounds.min.y, bounds.max.y] {
                        for z in [bounds.min.z, bounds.max.z] {
                            let point = camera.matrix().project_point3(Vec3::new(x, y, z));
                            let (u, v) = ((point.x + 1.0) / 2.0, (1.0 - point.y) / 2.0);
                            assert!(u >= frame[0] - 1e-4 && u <= frame[0] + frame[2] + 1e-4);
                            assert!(v >= frame[1] - 1e-4 && v <= frame[1] + frame[3] + 1e-4);
                            assert!(point.z.abs() <= 1.0);
                        }
                    }
                }
                let center = camera.matrix().project_point3(bounds.center());
                if centered {
                    assert!((center.x - (2.0 * frame[0] + frame[2] - 1.0)).abs() < 1e-4);
                    assert!((center.y - (1.0 - 2.0 * frame[1] - frame[3])).abs() < 1e-4);
                }
            }
        }
        let mut camera = original.clone();
        assert!(camera.contain(body, [0.0, 0.0, 0.0, 1.0], true).is_err());
        assert_eq!(camera.matrix(), original.matrix());
    }
    let mut camera = Camera::new(body);
    let part = Bounds {
        min: Vec3::new(0.1, 0.2, -0.1),
        max: Vec3::new(0.3, 0.4, 0.1),
    };
    let before = camera.matrix().project_point3(part.center());
    camera.contain(part, [0.1, 0.1, 0.8, 0.8], false).unwrap();
    let after = camera.matrix().project_point3(part.center());
    assert!(
        (before.truncate() - after.truncate()).length() < 1e-5,
        "Keep an already visible selection off center until the centering stage"
    );
}

#[test]
fn screen_zoom_keeps_the_pointer_ray_fixed_after_pan_rotation_and_focus() {
    let body = Bounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
    };
    let part = Bounds {
        min: Vec3::new(0.3, 0.5, -0.1),
        max: Vec3::new(0.5, 0.7, 0.1),
    };
    for aspect in [0.65, 1.6] {
        for focused in [false, true] {
            for (x, y) in [(0.0, 0.0), (-0.7, 0.6), (0.8, -0.5)] {
                let mut camera = Camera::new(body);
                camera.resize((1000.0 * aspect) as u32, 1000);
                if focused {
                    camera.focus(part, [0.2, 0.1, 0.6, 0.7]).unwrap();
                }
                camera.rotate(0.4, -0.2).unwrap();
                camera.pan(0.15, -0.12).unwrap();
                let before = camera.matrix();
                let depth = before.project_point3(camera.target).z;
                let anchor = before.inverse().project_point3(Vec3::new(x, y, depth));
                // Every depth on the pointer ray must stay under the cursor.
                let nearer = camera.eye().lerp(anchor, 0.7);
                let basis = camera.light_basis();
                let distance = camera.distance;
                for factor in [0.6, 1.0 / 0.6] {
                    camera.zoom_at(x, y, factor).unwrap();
                    for point in [anchor, nearer] {
                        let screen = camera.matrix().project_point3(point);
                        assert!((screen.x - x).abs() < 2e-4 && (screen.y - y).abs() < 2e-4);
                    }
                    assert_eq!(camera.light_basis(), basis);
                }
                assert!((camera.distance - distance).abs() < 1e-5);
                assert!(camera.matrix().abs_diff_eq(before, 1e-4));
                for (x, y, factor) in [
                    (f32::NAN, 0.0, 1.0),
                    (0.0, f32::INFINITY, 1.0),
                    (0.0, 0.0, 0.0),
                ] {
                    let before = camera.matrix();
                    assert!(camera.zoom_at(x, y, factor).is_err());
                    assert_eq!(camera.matrix(), before);
                }
            }
        }
    }
}

#[test]
fn screen_zoom_limits_stay_inside_the_enclosure_even_when_panned_away() {
    let bounds = Bounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
    };
    for pan in [0.3, 3.0, -3.0] {
        let mut camera = Camera::new(bounds);
        camera.pan(pan, -pan).unwrap();
        for factor in [0.001, 1000.0, 0.5, 2.0, 0.001] {
            camera.zoom_at(-0.7, 0.6, factor).unwrap();
            assert!(camera.eye().is_finite() && camera.matrix().is_finite());
            assert!(camera.eye().distance(bounds.center()) <= camera.enclosure_radius() * 0.90001);
        }
    }
}

#[test]
fn viewport_centering_preserves_zoom_orientation_and_depth() {
    let bounds = Bounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
    };
    let mut camera = Camera::new(bounds);
    camera.rotate(0.3, -0.1).unwrap();
    camera.pan(0.1, -0.2).unwrap();
    camera.zoom(0.6).unwrap();
    let eye = camera.eye();
    let distance = camera.distance;
    let basis = camera.light_basis();
    for pivot in [Vec3::new(0.6, 0.5, 0.1), bounds.center()] {
        let depth = camera.matrix().project_point3(pivot).z;
        for (x, y) in [(-0.4, 0.12), (0.0, 0.04), (-0.4, 0.12)] {
            camera.center_on(pivot, x, y).unwrap();
            assert!(
                camera
                    .matrix()
                    .project_point3(pivot)
                    .abs_diff_eq(Vec3::new(x, y, depth), 1e-5)
            );
            assert!(camera.eye().abs_diff_eq(eye, 1e-5));
            assert_eq!(camera.distance, distance);
            assert!(camera.light_basis().abs_diff_eq(basis, 1e-5));
            camera.rotate_around(pivot, 0.0, 0.0).unwrap();
        }
    }
    let before = camera.matrix();
    assert!(camera.center_on(Vec3::NAN, 0.0, 0.0).is_err());
    assert!(camera.center_on(Vec3::ZERO, f32::NAN, 0.0).is_err());
    assert_eq!(camera.matrix(), before);
}

#[test]
fn switching_orbit_pivots_preserves_the_view_and_rotates_around_each_selection() {
    let bounds = Bounds {
        min: Vec3::new(-0.4, 0.0, -0.3),
        max: Vec3::new(0.4, 1.8, 0.3),
    };
    let mut camera = Camera::new(bounds);
    camera.pan(0.15, -0.12).unwrap();
    camera.zoom(0.5).unwrap();
    for pivot in [
        Vec3::new(0.2, 1.6, 0.1),
        Vec3::new(-0.2, 0.3, -0.1),
        bounds.center(),
    ] {
        let before = camera.matrix();
        let distance = camera.distance;
        camera.rotate_around(pivot, 0.0, 0.0).unwrap();
        assert!(camera.matrix().abs_diff_eq(before, 1e-5));
        assert_eq!(camera.distance, distance, "Selection must preserve zoom");
        let screen = before.project_point3(pivot).truncate();
        for (yaw, pitch) in [(0.5, 0.2), (-1.1, -0.4), (2.3, 0.5)] {
            let eye_distance = camera.eye().distance(pivot);
            camera.rotate_around(pivot, yaw, pitch).unwrap();
            assert!((camera.eye().distance(pivot) - eye_distance).abs() < 1e-4);
            assert!((camera.matrix().project_point3(pivot).truncate() - screen).length() < 1e-4);
        }
        for factor in [0.7, 1.2, 0.9] {
            camera.zoom_around(pivot, factor).unwrap();
            assert!((camera.matrix().project_point3(pivot).truncate() - screen).length() < 1e-4);
        }
    }
    camera.zoom(100.0).unwrap();
    let pivot = Vec3::new(0.3, 1.7, 0.1);
    let screen = camera.matrix().project_point3(pivot).truncate();
    for _ in 0..20 {
        camera.rotate_around(pivot, 0.3, 0.05).unwrap();
        assert!(camera.eye().distance(bounds.center()) <= camera.enclosure_radius() * 0.90001);
        assert!((camera.matrix().project_point3(pivot).truncate() - screen).length() < 1e-4);
    }
    let before = camera.matrix();
    assert!(camera.rotate_around(Vec3::NAN, 0.1, 0.0).is_err());
    assert!(camera.rotate_around(pivot, f32::NAN, 0.0).is_err());
    assert_eq!(camera.matrix(), before);
}

#[test]
fn panning_keeps_the_model_pivot_and_rotation_keeps_its_screen_position() {
    let body = Bounds {
        min: Vec3::new(-0.4, 0.0, -0.3),
        max: Vec3::new(0.4, 1.8, 0.3),
    };
    let part = Bounds {
        min: Vec3::new(0.1, 1.5, 0.0),
        max: Vec3::new(0.2, 1.6, 0.1),
    };
    let mut focused = Camera::new(body);
    focused.focus(part, [0.25, 0.1, 0.5, 0.7]).unwrap();
    for mut camera in [
        Camera::new(body),
        focused,
        Camera::layout(body, 1.6, [0.25, 0.1, 0.5, 0.7]).unwrap(),
    ] {
        let pivot = camera.target;
        let before = camera.matrix().project_point3(pivot);
        camera.pan(0.13, -0.17).unwrap();
        assert_eq!(
            camera.target, pivot,
            "Pan must not move the orbit pivot away from the model"
        );
        let panned = camera.matrix().project_point3(pivot);
        assert!(
            panned.distance(before) > 0.1,
            "Pan must still reposition the model on screen"
        );
        for (yaw, pitch) in [(0.5, 0.2), (-1.1, -0.4), (2.3, 0.5)] {
            camera.rotate(yaw, pitch).unwrap();
            camera.zoom(0.8).unwrap();
            assert_eq!(camera.target, pivot);
            assert!(
                (camera.matrix().project_point3(pivot).truncate() - panned.truncate()).length()
                    < 1e-4,
                "Rotation must keep the off-center model pivot fixed on screen"
            );
        }
        camera.zoom(100.0).unwrap();
        camera.rotate(0.7, 0.5).unwrap();
        assert_eq!(
            camera.target, pivot,
            "Zoom limits must not move a focused model's pivot"
        );
        let (shadow_center, _) = camera.shadow_volume();
        assert!(
            shadow_center.distance(pivot) > 0.01,
            "Shadow detail must follow the panned view"
        );
        camera.reset();
        assert!(
            (camera.matrix().project_point3(pivot).truncate() - before.truncate()).length() < 1e-4
        );
    }
}

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
fn reframing_preserves_manual_camera_pose() {
    let bounds = Bounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
    };
    let mut camera = Camera::new(bounds);
    camera.focus(bounds, [0.24, 0.13, 0.45, 0.76]).unwrap();
    camera.rotate(0.4, -0.2).unwrap();
    camera.pan(0.08, -0.04).unwrap();
    camera.zoom(0.7).unwrap();
    let before = camera.matrix();
    for frame in [[0.03, 0.2, 0.94, 0.65], [0.24, 0.13, 0.45, 0.76]] {
        camera.reframe(frame).unwrap();
        assert_eq!(camera.matrix(), before);
    }
    assert!(camera.reframe([0.0, 0.0, 0.0, 1.0]).is_err());
    assert_eq!(camera.matrix(), before);
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
    let panned = camera.matrix().project_point3(bounds.center());
    assert!((panned.x + 0.2 / camera.aspect).abs() < 1e-5);
    assert!((panned.y - 0.44).abs() < 1e-5);
    camera.reset();
    check_frame(&camera);
}

#[test]
fn shadow_volume_tightens_while_zooming() {
    let bounds = Bounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
    };
    let mut camera = Camera::new(bounds);
    let (_, wide) = camera.shadow_volume();
    assert!((wide - bounds.radius() * 1.01).abs() < 1e-4);
    camera.zoom(0.1).unwrap();
    let (center, tight) = camera.shadow_volume();
    assert!(tight < wide * 0.5, "zoom must shrink the shadow frustum");
    assert!((center - camera.target).length() < 1e-6);
    // Fitted frustum must still project its own center inside clip space.
    let light = camera.light_basis() * Vec3::new(std::f32::consts::FRAC_1_SQRT_2, 0.5, 0.5);
    let matrix = Bounds::shadow_matrix_at(center, tight, light);
    assert!(matrix.is_finite());
    assert!(matrix.project_point3(center).abs().max_element() <= 1.0);
}
