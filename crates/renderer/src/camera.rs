use crate::Bounds;
use glam::{Mat3, Mat4, Vec3};

#[derive(Clone)]
pub struct Camera {
    pub target: Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub distance: f32,
    pub aspect: f32,
    radius: f32,
    center: Vec3,
    view: Bounds,
    frame: Option<[f32; 4]>,
    composition: Vec3,
    pan_offset: Vec3,
}

impl Camera {
    pub fn new(bounds: Bounds) -> Self {
        let mut camera = Self {
            target: bounds.center(),
            yaw: 0.0,
            pitch: 0.0,
            distance: 1.0,
            aspect: 1.0,
            radius: bounds.radius(),
            center: bounds.center(),
            view: bounds,
            frame: None,
            composition: Vec3::new(0.0, 0.04, 0.0),
            pan_offset: Vec3::ZERO,
        };
        camera.fit(bounds);
        camera
    }
    pub fn fit(&mut self, bounds: Bounds) {
        self.pan_offset = Vec3::ZERO;
        self.view = bounds;
        self.target = bounds.center();
        self.yaw = -0.32;
        self.pitch = 0.12;
        let fov = 38_f32.to_radians();
        let [_, _, width, height] = self.frame.unwrap_or([0.0, 0.0, 1.0, 1.0]);
        let limiting = (2.0 * ((fov * 0.5).tan() * height).atan())
            .min(2.0 * ((fov * 0.5).tan() * self.aspect * width).atan());
        let initial_fov = fov.min(2.0 * ((fov * 0.5).tan() * self.aspect).atan());
        let initial_distance = self.radius / (initial_fov * 0.5).sin() * 1.12;
        // Focus can enlarge a part, but must not shrink it below the startup scale.
        self.distance = (bounds.radius().max(self.radius * 1e-6) / (limiting * 0.5).sin() * 1.12)
            .min(initial_distance)
            .min(self.enclosure_radius() * 0.9);
        self.constrain_eye();
    }
    pub fn focus(&mut self, bounds: Bounds, frame: [f32; 4]) -> Result<(), String> {
        self.reframe(frame)?;
        self.fit(bounds);
        Ok(())
    }
    pub fn reframe(&mut self, frame: [f32; 4]) -> Result<(), String> {
        let [left, top, width, height] = frame;
        if frame.iter().any(|v| !v.is_finite())
            || left < 0.0
            || top < 0.0
            || width <= 0.0
            || height <= 0.0
            || left + width > 1.000001
            || top + height > 1.000001
        {
            return Err("Invalid focus viewport".into());
        }
        // Full-viewport framing uses the same centered composition as startup.
        self.frame = (frame != [0.0, 0.0, 1.0, 1.0]).then_some(frame);
        Ok(())
    }
    pub fn layout(bounds: Bounds, aspect: f32, frame: [f32; 4]) -> Result<Self, String> {
        if !aspect.is_finite() || aspect <= 0.0 {
            return Err("Invalid layout aspect ratio".into());
        }
        let mut camera = Self::new(bounds);
        camera.aspect = aspect;
        camera.focus(bounds, frame)?;
        let fov = 38_f32.to_radians();
        let half_size = (bounds.max - bounds.min) * 0.5;
        let distance = (half_size.x / ((fov * 0.5).tan() * aspect * frame[2]))
            .max(half_size.y / ((fov * 0.5).tan() * frame[3]));
        camera.distance = half_size.z + distance * 1.12;
        // Leave room to pan and zoom after fitting a narrow viewport.
        camera.radius = camera.radius.max(camera.distance / 4.0);
        camera.yaw = 0.0;
        camera.pitch = 0.0;
        camera.composition = Vec3::new(
            2.0 * (frame[0] + frame[2] * 0.5) - 1.0,
            1.0 - 2.0 * (frame[1] + frame[3] * 0.5),
            0.0,
        );
        Ok(camera)
    }
    pub fn approach(&mut self, goal: &Self, blend: f32) -> bool {
        if blend == 1.0 {
            *self = goal.clone();
            return false;
        }
        self.target = self.target.lerp(goal.target, blend);
        self.distance += (goal.distance - self.distance) * blend;
        let yaw = (goal.yaw - self.yaw + std::f32::consts::PI).rem_euclid(std::f32::consts::TAU)
            - std::f32::consts::PI;
        self.yaw += yaw * blend;
        self.pitch += (goal.pitch - self.pitch) * blend;
        self.radius += (goal.radius - self.radius) * blend;
        self.center = self.center.lerp(goal.center, blend);
        self.composition = self.composition.lerp(goal.composition, blend);
        self.pan_offset = self.pan_offset.lerp(goal.pan_offset, blend);
        self.view = goal.view;
        self.frame = goal.frame;
        let tolerance = goal.radius * 1e-5;
        let moving = self.target.distance(goal.target) > tolerance
            || (self.distance - goal.distance).abs() > tolerance
            || yaw.abs() > 1e-5
            || (self.pitch - goal.pitch).abs() > 1e-5;
        let moving = moving
            || self.composition.distance(goal.composition) > 1e-5
            || self.pan_offset.distance(goal.pan_offset) > 1e-5;
        if !moving {
            *self = goal.clone();
        }
        moving
    }
    pub fn contain(
        &mut self,
        bounds: Bounds,
        frame: [f32; 4],
        centered: bool,
    ) -> Result<(), String> {
        // Validate with the same viewport contract as focus and layout.
        Self::layout(bounds, self.aspect, frame)?;
        let pivot = bounds.center();
        let point = self.matrix() * pivot.extend(1.0);
        let center = Vec3::new(
            2.0 * (frame[0] + frame[2] * 0.5) - 1.0,
            1.0 - 2.0 * (frame[1] + frame[3] * 0.5),
            0.0,
        );
        let previous = if point.w > 1e-6 {
            point.truncate() / point.w
        } else {
            center
        };
        let basis = self.light_basis().transpose();
        let mut corners = Vec::with_capacity(8);
        for x in [bounds.min.x, bounds.max.x] {
            for y in [bounds.min.y, bounds.max.y] {
                for z in [bounds.min.z, bounds.max.z] {
                    let corner = Vec3::new(x, y, z);
                    let local = basis * (corner - pivot);
                    let fit = local.z
                        + (local.x.abs() / (self.aspect * frame[2])).max(local.y.abs() / frame[3])
                            / (19_f32.to_radians().tan() * 0.9);
                    self.distance = self.distance.max(fit);
                    corners.push(corner);
                }
            }
        }
        self.target = pivot;
        self.center = pivot;
        self.radius = self.radius.max(self.distance / 4.0);
        self.center_on(pivot, 0.0, 0.0)?;
        let matrix = self.matrix();
        let mut min = Vec3::splat(f32::INFINITY);
        let mut max = Vec3::splat(f32::NEG_INFINITY);
        for corner in corners {
            let point = matrix.project_point3(corner);
            min = min.min(point);
            max = max.max(point);
        }
        let x = if centered {
            center.x
        } else {
            previous
                .x
                .clamp(center.x - frame[2] - min.x, center.x + frame[2] - max.x)
        };
        let y = if centered {
            center.y
        } else {
            previous
                .y
                .clamp(center.y - frame[3] - min.y, center.y + frame[3] - max.y)
        };
        self.center_on(pivot, x, y)
    }
    pub fn resize(&mut self, width: u32, height: u32) {
        self.aspect = width.max(1) as f32 / height.max(1) as f32;
        self.reset();
    }
    pub fn reset(&mut self) {
        self.fit(self.view);
    }
    pub fn rotate(&mut self, yaw: f32, pitch: f32) -> Result<(), String> {
        self.rotate_around(self.target, yaw, pitch)
    }
    pub fn rotate_around(&mut self, pivot: Vec3, yaw: f32, pitch: f32) -> Result<(), String> {
        if !pivot.is_finite() || !yaw.is_finite() || !pitch.is_finite() {
            return Err("Invalid camera rotation".into());
        }
        self.orient_around(
            pivot,
            self.yaw + yaw,
            (self.pitch + pitch).clamp(-1.55, 1.55),
        )
    }
    pub fn orient_around(&mut self, pivot: Vec3, yaw: f32, pitch: f32) -> Result<(), String> {
        if !pivot.is_finite()
            || !yaw.is_finite()
            || !pitch.is_finite()
            || pitch.abs() > std::f32::consts::FRAC_PI_2
        {
            return Err("Invalid camera orientation".into());
        }
        let offset = self.light_basis().transpose() * (self.target - pivot);
        self.yaw = yaw.rem_euclid(std::f32::consts::TAU);
        self.pitch = pitch;
        // Rotate the existing view around the selection without first recentering it.
        self.target = pivot + self.light_basis() * offset;
        self.constrain_orbit(pivot);
        Ok(())
    }
    pub fn zoom(&mut self, factor: f32) -> Result<(), String> {
        self.zoom_around(self.target, factor)
    }
    pub fn zoom_at(&mut self, x: f32, y: f32, factor: f32) -> Result<(), String> {
        if !x.is_finite() || !y.is_finite() {
            return Err("Invalid camera zoom position".into());
        }
        // Intersect the pointer ray with the target plane, including screen pan.
        let screen = Vec3::new(x, y, 0.0) - self.composition - self.pan_offset;
        let offset = Vec3::new(screen.x * self.aspect, screen.y, 0.0)
            * self.distance
            * 19_f32.to_radians().tan();
        self.zoom_around(self.target + self.light_basis() * offset, factor)
    }
    pub fn zoom_around(&mut self, pivot: Vec3, factor: f32) -> Result<(), String> {
        if !pivot.is_finite() || !factor.is_finite() || factor <= 0.0 {
            return Err("Invalid camera zoom".into());
        }
        let distance = (self.distance * factor).clamp(
            self.view.radius().max(self.radius * 1e-6) * 0.1,
            self.enclosure_radius() * 0.9,
        );
        if self.distance > 0.0 {
            self.target = pivot + (self.target - pivot) * (distance / self.distance);
        }
        self.distance = distance;
        self.constrain_orbit(pivot);
        Ok(())
    }
    pub fn pan(&mut self, x: f32, y: f32) -> Result<(), String> {
        if !x.is_finite() || !y.is_finite() {
            return Err("Invalid camera pan".into());
        }
        let next = self.pan_offset - Vec3::new(2.0 * x / self.aspect, 2.0 * y, 0.0);
        if !next.is_finite() {
            return Err("Camera pan exceeds finite coordinates".into());
        }
        self.pan_offset = next;
        Ok(())
    }
    pub fn center_on(&mut self, pivot: Vec3, x: f32, y: f32) -> Result<(), String> {
        if !pivot.is_finite() || !x.is_finite() || !y.is_finite() {
            return Err("Invalid camera center".into());
        }
        let point = self.matrix() * pivot.extend(1.0);
        if point.w > 1e-6 {
            self.pan_offset += Vec3::new(x - point.x / point.w, y - point.y / point.w, 0.0);
        }
        Ok(())
    }
    pub fn enclosure_radius(&self) -> f32 {
        self.radius * 6.0
    }
    pub fn enclosure_center(&self) -> Vec3 {
        self.center
    }
    fn constrain_eye(&mut self) {
        self.constrain_orbit(self.target);
    }
    fn constrain_orbit(&mut self, pivot: Vec3) {
        let limit = self.enclosure_radius() * 0.9;
        let offset = self.eye() - pivot;
        let distance = offset.length();
        if limit > 0.0 && distance > 0.0 {
            let relative = (pivot - self.center) / limit;
            let along = relative.dot(offset / distance);
            let half = (along * along + 1.0 - relative.length_squared())
                .max(0.0)
                .sqrt();
            // A pointer pivot may be outside the enclosure after panning.
            let minimum = (-half - along).max(0.0) * limit;
            let maximum = (half - along) * limit;
            if maximum > 0.0 && (distance < minimum || distance > maximum) {
                let scale = distance.clamp(minimum, maximum) / distance;
                self.target = pivot + (self.target - pivot) * scale;
                self.distance *= scale;
            }
        }
    }
    pub fn eye(&self) -> Vec3 {
        self.target + self.orbit_offset()
    }
    /// Focus volume the shadow map should cover: the viewed region around the
    /// orbit target with a margin for nearby casters. Shrinks while zooming so
    /// close-ups keep dense shadow texels instead of magnified stairs.
    pub fn shadow_volume(&self) -> (Vec3, f32) {
        let half_height = self.distance * (19_f32.to_radians()).tan();
        let half_width = half_height * self.aspect.max(1e-6);
        let radius =
            (half_height.max(half_width) * 2.0).clamp(self.radius * 0.01, self.radius * 1.01);
        let basis = self.light_basis();
        let center = self.target
            - basis.x_axis * self.pan_offset.x * half_width
            - basis.y_axis * self.pan_offset.y * half_height;
        (center, radius)
    }
    pub fn light_basis(&self) -> Mat3 {
        Mat3::from_rotation_y(self.yaw) * Mat3::from_rotation_x(-self.pitch)
    }
    fn orbit_offset(&self) -> Vec3 {
        Vec3::new(
            self.yaw.sin() * self.pitch.cos(),
            self.pitch.sin(),
            self.yaw.cos() * self.pitch.cos(),
        ) * self.distance
    }
    pub fn matrix(&self) -> Mat4 {
        // Anatomy retains startup framing; inventory uses the available viewport.
        Mat4::from_translation(self.composition + self.pan_offset)
            * glam::camera::rh::proj::opengl::perspective(
                38_f32.to_radians(),
                self.aspect,
                (self.view.radius() / 100.0).max(1e-6),
                self.radius * 100.0,
            )
            * glam::camera::rh::view::look_at_mat4(
                self.eye(),
                self.target,
                self.light_basis().y_axis,
            )
    }
}
