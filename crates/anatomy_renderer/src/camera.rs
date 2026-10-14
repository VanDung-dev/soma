use crate::Bounds;
use glam::{Mat3, Mat4, Vec3};

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
        };
        camera.fit(bounds);
        camera
    }
    pub fn fit(&mut self, bounds: Bounds) {
        self.view = bounds;
        self.target = bounds.center();
        self.yaw = -0.32;
        self.pitch = 0.12;
        let fov = 38_f32.to_radians();
        let [_, _, width, height] = self.frame.unwrap_or([0.0, 0.0, 1.0, 1.0]);
        let limiting = (2.0 * ((fov * 0.5).tan() * height).atan())
            .min(2.0 * ((fov * 0.5).tan() * self.aspect * width).atan());
        self.distance = (bounds.radius().max(self.radius * 1e-6) / (limiting * 0.5).sin() * 1.12)
            .min(self.enclosure_radius() * 0.9);
        self.constrain_eye();
    }
    pub fn focus(&mut self, bounds: Bounds, frame: [f32; 4]) -> Result<(), String> {
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
        self.frame = Some(frame);
        self.fit(bounds);
        Ok(())
    }
    pub fn reframe(&mut self, frame: [f32; 4]) -> Result<(), String> {
        if self.frame.is_some() {
            self.focus(self.view, frame)?;
        }
        Ok(())
    }
    pub fn resize(&mut self, width: u32, height: u32) {
        self.aspect = width.max(1) as f32 / height.max(1) as f32;
        self.reset();
    }
    pub fn reset(&mut self) {
        self.fit(self.view);
    }
    pub fn rotate(&mut self, yaw: f32, pitch: f32) -> Result<(), String> {
        if !yaw.is_finite() || !pitch.is_finite() {
            return Err("Invalid camera rotation".into());
        }
        self.yaw = (self.yaw + yaw).rem_euclid(std::f32::consts::TAU);
        self.pitch = (self.pitch + pitch).clamp(-1.55, 1.55);
        self.constrain_eye();
        Ok(())
    }
    pub fn zoom(&mut self, factor: f32) -> Result<(), String> {
        if !factor.is_finite() || factor <= 0.0 {
            return Err("Invalid camera zoom".into());
        }
        self.distance = (self.distance * factor).clamp(
            self.view.radius().max(self.radius * 1e-6) * 0.1,
            self.enclosure_radius() * 0.9,
        );
        self.constrain_eye();
        Ok(())
    }
    pub fn pan(&mut self, x: f32, y: f32) -> Result<(), String> {
        if !x.is_finite() || !y.is_finite() {
            return Err("Invalid camera pan".into());
        }
        let forward = (self.target - self.eye()).normalize();
        let right = forward.cross(Vec3::Y).normalize();
        let up = right.cross(forward);
        let next =
            self.target + (right * x + up * y) * self.distance * (19_f32.to_radians()).tan() * 2.0;
        if !next.is_finite() || !(next + self.orbit_offset()).is_finite() {
            return Err("Camera pan exceeds finite coordinates".into());
        }
        self.target = next;
        self.constrain_eye();
        Ok(())
    }
    pub fn enclosure_radius(&self) -> f32 {
        self.radius * 6.0
    }
    fn constrain_eye(&mut self) {
        let offset = self.orbit_offset();
        let delta = self.target + offset - self.center;
        let scale = delta.abs().max_element();
        if scale > 0.0 {
            // Normalize after scaling so even very large, finite pan inputs remain bounded.
            let direction = delta / scale;
            let length = direction.length();
            let limit = self.enclosure_radius() * 0.9;
            if scale > limit / length {
                self.target = self.center + direction / length * limit - offset;
            }
        }
    }
    pub fn eye(&self) -> Vec3 {
        self.target + self.orbit_offset()
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
        // Shift the projection into the available UI area without moving anatomy in world space.
        let composition = self
            .frame
            .map(|[left, top, width, height]| {
                Vec3::new(left * 2.0 + width - 1.0, 1.0 - top * 2.0 - height, 0.0)
            })
            .unwrap_or(Vec3::new(0.0, 0.04, 0.0));
        Mat4::from_translation(composition)
            * glam::camera::rh::proj::opengl::perspective(
                38_f32.to_radians(),
                self.aspect,
                (self.view.radius() / 100.0).max(1e-6),
                self.radius * 100.0,
            )
            * glam::camera::rh::view::look_at_mat4(self.eye(), self.target, Vec3::Y)
    }
}
