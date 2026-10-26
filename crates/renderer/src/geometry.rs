use glam::{Mat4, Vec3};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Bounds {
    pub min: Vec3,
    pub max: Vec3,
}

impl Bounds {
    pub fn center(self) -> Vec3 {
        (self.min + self.max) * 0.5
    }
    pub fn radius(self) -> f32 {
        (self.max - self.min).length() * 0.5
    }
    pub fn translated(self, offset: Vec3) -> Self {
        Self {
            min: self.min + offset,
            max: self.max + offset,
        }
    }
    pub fn shadow_matrix(self, light: Vec3) -> Mat4 {
        Self::shadow_matrix_at(self.center(), self.radius().max(0.001) * 1.01, light)
    }
    /// Orthographic shadow frustum around an arbitrary focus volume. Fitting the
    /// frustum to the viewed region (instead of the whole scene) keeps shadow
    /// texels small on screen when zoomed in, which is what removes the
    /// staircase at close range.
    pub fn shadow_matrix_at(center: Vec3, radius: f32, light: Vec3) -> Mat4 {
        let radius = radius.max(1e-6);
        glam::camera::rh::proj::opengl::orthographic(
            -radius,
            radius,
            -radius,
            radius,
            radius,
            radius * 3.0,
        ) * glam::camera::rh::view::look_at_mat4(center + light * radius * 2.0, center, Vec3::Y)
    }
    pub fn union(self, other: Self) -> Self {
        Self {
            min: self.min.min(other.min),
            max: self.max.max(other.max),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Primitive {
    pub source_id: String,
    #[serde(skip)]
    pub vertices: Vec<f32>,
    #[serde(skip)]
    pub indices: Vec<u32>,
    pub bounds: Bounds,
    pub color: [f32; 4],
    pub roughness: f32,
    pub metallic: f32,
    pub specular: f32,
    pub subsurface: f32,
    pub double_sided: bool,
    pub blend: bool,
    pub alpha_cutoff: f32,
    pub active: bool,
    pub visible: bool,
}
