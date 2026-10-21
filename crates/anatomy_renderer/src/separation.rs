use crate::{Camera, Scene};
use glam::Vec3;
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub struct Separation {
    offsets: HashMap<String, Vec3>,
    groups: Vec<Vec<String>>,
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
            self.groups.clear();
        } else {
            for member in self.members(id) {
                self.offsets.remove(&member);
            }
            self.groups
                .retain(|group| !group.iter().any(|member| member == id));
        }
    }

    pub fn members(&self, id: &str) -> Vec<String> {
        self.groups
            .iter()
            .find(|group| group.iter().any(|member| member == id))
            .cloned()
            .unwrap_or_else(|| vec![id.into()])
    }

    pub fn separated_ids(&self) -> Vec<String> {
        let mut ids: Vec<_> = self.offsets.keys().cloned().collect();
        ids.sort();
        ids
    }

    pub fn detach(&mut self, id: &str) {
        for group in &mut self.groups {
            group.retain(|member| member != id);
        }
        self.groups.retain(|group| group.len() > 1);
    }

    pub fn candidate(&self, scene: &Scene, id: &str, tolerance: f32) -> Option<String> {
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return None;
        }
        let members: HashSet<_> = self.members(id).into_iter().collect();
        let moving: Vec<_> = scene
            .parts
            .iter()
            .filter(|part| part.active && part.visible && members.contains(&part.source_id))
            .collect();
        if !moving.iter().any(|part| part.source_id == id) {
            return None;
        }
        let neighbor_gap = scene.bounds.radius() * 0.005;
        let offset = self.offset(id);
        let mut best: Option<(f32, &str)> = None;
        for target in scene
            .parts
            .iter()
            .filter(|part| part.active && part.visible && !members.contains(&part.source_id))
        {
            let distance = offset.distance_squared(self.offset(&target.source_id));
            if distance > tolerance * tolerance {
                continue;
            }
            let gap = moving
                .iter()
                .map(|part| {
                    (part.bounds.min - target.bounds.max)
                        .max(target.bounds.min - part.bounds.max)
                        .max(Vec3::ZERO)
                        .length_squared()
                })
                .fold(f32::INFINITY, f32::min);
            if gap > neighbor_gap * neighbor_gap {
                continue;
            }
            let score = distance + gap;
            if best.is_none_or(|(previous, previous_id)| {
                score < previous || (score == previous && target.source_id.as_str() < previous_id)
            }) {
                best = Some((score, &target.source_id));
            }
        }
        best.map(|(_, target)| target.into())
    }

    pub fn snap(
        &mut self,
        scene: &Scene,
        id: &str,
        target: &str,
        tolerance: f32,
    ) -> Result<(), String> {
        if self.candidate(scene, id, tolerance).as_deref() != Some(target) {
            return Err("Structures are not close enough to connect".into());
        }
        let offset = self.offset(target);
        self.set(scene, id, offset.to_array())?;
        let mut members = self.members(id);
        members.extend(self.members(target));
        self.groups
            .retain(|group| !group.iter().any(|member| members.contains(member)));
        if offset != Vec3::ZERO {
            members.sort();
            members.dedup();
            self.groups.push(members);
        }
        Ok(())
    }

    pub fn set(&mut self, scene: &Scene, id: &str, offset: [f32; 3]) -> Result<(), String> {
        let offset = Vec3::from(offset);
        if !offset.is_finite() || !scene.parts.iter().any(|p| p.active && p.source_id == id) {
            return Err("Invalid separated structure or position".into());
        }
        let offset = offset.clamp_length_max(scene.bounds.radius() * 3.0);
        for member in self.members(id) {
            if offset.length_squared() == 0.0 {
                self.offsets.remove(&member);
            } else {
                self.offsets.insert(member, offset);
            }
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
