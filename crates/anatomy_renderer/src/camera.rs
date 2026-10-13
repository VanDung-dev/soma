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
        let limiting = fov.min(2.0 * ((fov * 0.5).tan() * self.aspect).atan());
        self.distance = (bounds.radius().max(self.radius * 1e-6) / (limiting * 0.5).sin() * 1.12)
            .min(self.enclosure_radius() * 0.9);
        self.constrain_eye();
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
        // Raise the composition slightly without moving anatomy or the enclosure in world space.
        Mat4::from_translation(Vec3::new(0.0, 0.04, 0.0))
            * glam::camera::rh::proj::opengl::perspective(
                38_f32.to_radians(),
                self.aspect,
                (self.view.radius() / 100.0).max(1e-6),
                self.radius * 100.0,
            )
            * glam::camera::rh::view::look_at_mat4(self.eye(), self.target, Vec3::Y)
    }
}
