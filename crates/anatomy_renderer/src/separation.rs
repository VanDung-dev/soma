use crate::{Camera, Scene};
use glam::Vec3;
use std::collections::HashMap;

#[derive(Default)]
pub struct Separation {
    offsets: HashMap<String, Vec3>,
}

impl Separation {
    pub fn offset(&self, id: &str) -> Vec3 {
        self.offsets.get(id).copied().unwrap_or(Vec3::ZERO)
    }

    pub fn moved(&self, id: &str) -> bool {
        self.offsets.contains_key(id)
    }

    pub fn is_empty(&self) -> bool {
        self.offsets.is_empty()
    }

    pub fn clear(&mut self, id: &str) {
        if id.is_empty() {
            self.offsets.clear();
        } else {
            self.offsets.remove(id);
        }
    }

    pub fn set(&mut self, scene: &Scene, id: &str, offset: [f32; 3]) -> Result<(), String> {
        let offset = Vec3::from(offset);
        if !offset.is_finite() || !scene.parts.iter().any(|p| p.active && p.source_id == id) {
            return Err("Invalid separated structure or position".into());
        }
        let offset = offset.clamp_length_max(scene.bounds.radius() * 3.0);
        if offset.length_squared() == 0.0 {
            self.offsets.remove(id);
        } else {
            self.offsets.insert(id.into(), offset);
        }
        Ok(())
    }

    pub fn drag(
        &mut self,
        scene: &Scene,
        camera: &Camera,
        id: &str,
        x: f32,
        y: f32,
    ) -> Result<(), String> {
        if !x.is_finite() || !y.is_finite() {
            return Err("Invalid structure drag".into());
        }
        let bounds = scene.bounds_for(&[id.into()])?.ok_or("Unknown structure")?;
        let offset = self.offset(id);
        let matrix = camera.matrix();
        let point = matrix * (bounds.center() + offset).extend(1.0);
        if point.w <= 1e-6 {
            return Ok(());
        }
        let screen = point.truncate() / point.w;
        let inverse = matrix.inverse();
        let delta = inverse.project_point3(screen + Vec3::new(x * 2.0, -y * 2.0, 0.0))
            - inverse.project_point3(screen);
        self.set(scene, id, (offset + delta).to_array())
    }
}
