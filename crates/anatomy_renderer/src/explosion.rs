use crate::{Bounds, Camera, Reconstruction, Scene};
use glam::Vec3;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Default)]
pub struct Explosion {
    groups: HashMap<String, usize>,
    group_count: usize,
    offsets: Vec<Vec3>,
    targets: Vec<Vec3>,
    time: Option<f64>,
    amount: f32,
}

impl Explosion {
    pub fn new(scene: &Scene, groups: Vec<Vec<String>>) -> Result<Self, String> {
        let known: HashSet<_> = scene.parts.iter().map(|p| p.source_id.as_str()).collect();
        let mut membership = HashMap::new();
        for (group, ids) in groups.iter().enumerate() {
            for id in ids {
                if !known.contains(id.as_str()) || membership.insert(id.clone(), group).is_some() {
                    return Err("Unknown or duplicate explosion structure ID".into());
                }
            }
        }
        if membership.len() != known.len() {
            return Err("Explosion groups must cover every structure".into());
        }
        Ok(Self {
            groups: membership,
            group_count: groups.len(),
            offsets: vec![Vec3::ZERO; scene.parts.len()],
            targets: vec![Vec3::ZERO; scene.parts.len()],
            ..Self::default()
        })
    }

    pub fn amount(&self) -> f32 {
        self.amount
    }
    pub fn configured(&self) -> bool {
        !self.groups.is_empty()
    }
    pub fn offset(&self, index: usize) -> Vec3 {
        self.offsets.get(index).copied().unwrap_or(Vec3::ZERO)
    }

    pub fn set(&mut self, amount: f32, now: f64) -> Result<(), String> {
        if !amount.is_finite()
            || !(0.0..=1.0).contains(&amount)
            || !now.is_finite()
            || self.time.is_some_and(|time| now < time)
        {
            return Err("Invalid explosion amount or timestamp".into());
        }
        self.amount = amount;
        self.time = Some(now);
        Ok(())
    }

    pub fn layout(&mut self, scene: &Scene, aspect: f32) -> Bounds {
        self.layout_revealed(scene, aspect, &Reconstruction::default())
    }

    pub fn layout_revealed(
        &mut self,
        scene: &Scene,
        aspect: f32,
        reveal: &Reconstruction,
    ) -> Bounds {
        // Shelf layout adapted from human-atlas-demo; see LICENSES/human-atlas-demo-MIT.txt.
        let mut structures = BTreeMap::<&str, Bounds>::new();
        for (_, part) in scene
            .parts
            .iter()
            .enumerate()
            .filter(|(i, p)| p.visible || reveal.fading_out(*i))
        {
            structures
                .entry(&part.source_id)
                .and_modify(|bounds| *bounds = bounds.union(part.bounds))
                .or_insert(part.bounds);
        }
        let scale = scene.bounds.radius();
        let center = scene.bounds.center();
        let gap = scale * 0.04;
        // Stagger each depth layer by half the body width, keeping anatomical height.
        let size = scene.bounds.max - scene.bounds.min;
        let layer_step = Vec3::new(size.x * 0.5, 0.0, size.z + gap * 2.0);
        let mut cards: Vec<_> = structures
            .into_iter()
            .map(|(id, bounds)| {
                let size = bounds.max - bounds.min;
                (
                    id,
                    bounds,
                    size.x.max(scale * 0.035) + gap,
                    size.y.max(scale * 0.035) + gap,
                )
            })
            .collect();
        cards.sort_by(|a, b| b.3.total_cmp(&a.3).then_with(|| a.0.cmp(b.0)));
        let area: f32 = cards.iter().map(|c| c.2 * c.3).sum();
        let width = cards
            .iter()
            .map(|c| c.2)
            .fold(scale * 0.3, f32::max)
            .max((area * aspect.clamp(0.5, 1.5)).sqrt() * 1.18);
        let (mut x, mut y, mut row, mut used_width) = (0.0_f32, 0.0_f32, 0.0_f32, 0.0_f32);
        let mut cells = HashMap::new();
        for (id, bounds, w, h) in cards {
            if x > 0.0 && x + w > width {
                x = 0.0;
                y += row;
                row = 0.0;
            }
            cells.insert(id, (Vec3::new(x + w * 0.5, -y - h * 0.5, 0.0), bounds));
            x += w;
            used_width = used_width.max(x);
            row = row.max(h);
        }
        let shift = center + Vec3::new(-used_width * 0.5, (y + row) * 0.5, 0.0);
        self.targets = scene
            .parts
            .iter()
            .map(|part| {
                let Some((cell, bounds)) = cells.get(part.source_id.as_str()) else {
                    return Vec3::ZERO;
                };
                let group = self.groups.get(&part.source_id).copied().unwrap_or(0);
                let layer = group as f32 - (self.group_count as f32 - 1.0) * 0.5;
                let layer = Vec3::new(layer * layer_step.x, 0.0, layer * layer_step.z);
                let expanded = layer * 1.8 + (bounds.center() - center) * 0.65;
                if self.amount <= 0.3 {
                    layer * (self.amount / 0.3)
                } else if self.amount <= 0.6 {
                    layer.lerp(expanded, (self.amount - 0.3) / 0.3)
                } else {
                    expanded.lerp(*cell + shift - bounds.center(), (self.amount - 0.6) / 0.4)
                }
            })
            .collect();
        scene
            .parts
            .iter()
            .enumerate()
            .filter(|(i, p)| p.visible || reveal.fading_out(*i))
            .map(|(i, p)| p.bounds.translated(self.targets[i]))
            .reduce(Bounds::union)
            .unwrap_or(scene.bounds)
    }

    pub fn overview_camera(
        &self,
        scene: &Scene,
        aspect: f32,
        frame: [f32; 4],
    ) -> Result<Camera, String> {
        self.overview_camera_revealed(scene, aspect, frame, &Reconstruction::default())
    }

    pub fn overview_camera_revealed(
        &self,
        scene: &Scene,
        aspect: f32,
        frame: [f32; 4],
        reveal: &Reconstruction,
    ) -> Result<Camera, String> {
        let displayed: Vec<_> = scene
            .parts
            .iter()
            .zip(&self.targets)
            .enumerate()
            .filter(|(i, (part, _))| part.visible || reveal.fading_out(*i))
            .map(|(_, (part, offset))| part.bounds.translated(*offset))
            .collect();
        let bounds = displayed
            .iter()
            .copied()
            .reduce(Bounds::union)
            .unwrap_or(scene.bounds);
        let mut camera = Camera::layout(bounds, aspect, frame)?;
        let matrix = camera.matrix();
        let mut min = Vec3::splat(f32::INFINITY);
        let mut max = Vec3::splat(f32::NEG_INFINITY);
        for bounds in &displayed {
            for x in [bounds.min.x, bounds.max.x] {
                for y in [bounds.min.y, bounds.max.y] {
                    for z in [bounds.min.z, bounds.max.z] {
                        let point = matrix.project_point3(Vec3::new(x, y, z));
                        min = min.min(point);
                        max = max.max(point);
                    }
                }
            }
        }
        if !displayed.is_empty() {
            // Perspective shifts the visible envelope away from the 3D bounds center.
            let center = (min + max) * 0.5;
            camera.pan(
                (center.x - (2.0 * frame[0] + frame[2] - 1.0)) * aspect * 0.5,
                (center.y - (1.0 - 2.0 * frame[1] - frame[3])) * 0.5,
            )?;
        }
        Ok(camera)
    }

    pub fn advance(&mut self, now: f64, scale: f32) -> Result<(bool, f32), String> {
        if !now.is_finite() || self.time.is_some_and(|time| now < time) {
            return Err("Invalid explosion timestamp".into());
        }
        let dt = ((now - self.time.unwrap_or(now)) / 1000.0).clamp(0.0, 0.05) as f32;
        self.time = Some(now);
        let blend = 1.0 - (-12.0 * dt).exp();
        let mut moving = false;
        for (offset, target) in self.offsets.iter_mut().zip(&self.targets) {
            *offset = offset.lerp(*target, blend);
            if offset.distance(*target) < scale * 1e-5 {
                *offset = *target;
            } else {
                moving = true;
            }
        }
        Ok((moving, blend))
    }

    pub fn finish(&mut self) {
        self.offsets.clone_from(&self.targets);
    }
    pub fn clear(&mut self) {
        self.offsets.fill(Vec3::ZERO);
        self.targets.fill(Vec3::ZERO);
        self.time = None;
        self.amount = 0.0;
    }
}
