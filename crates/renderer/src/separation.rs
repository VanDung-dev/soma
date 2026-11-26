use crate::{Camera, Scene};
use glam::Vec3;
use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub struct Separation {
    offsets: HashMap<String, Vec3>,
    groups: Vec<Vec<String>>,
    drag: Option<Drag>,
    restoration: Option<Restoration>,
}

struct Drag {
    anchor: String,
    selection: bool,
    members: Vec<String>,
    offsets: Vec<Vec3>,
}

struct Restoration {
    started: f64,
    previous: f64,
    offsets: HashMap<String, Vec3>,
    all: bool,
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
        self.drag = None;
        self.restoration = None;
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
        self.restoration = None;
        for group in &mut self.groups {
            group.retain(|member| member != id);
        }
        self.groups.retain(|group| group.len() > 1);
    }

    pub fn begin_drag(&mut self, anchor: &str, selection: Option<Vec<String>>) {
        let grouped = selection.is_some();
        let members = selection.unwrap_or_else(|| self.members(anchor));
        let offsets = members.iter().map(|id| self.offset(id)).collect();
        self.drag = Some(Drag {
            anchor: anchor.into(),
            selection: grouped,
            members,
            offsets,
        });
    }

    pub fn active_drag(&self) -> Option<(&str, bool)> {
        self.drag
            .as_ref()
            .map(|drag| (drag.anchor.as_str(), drag.selection))
    }

    pub fn move_drag(
        &mut self,
        scene: &Scene,
        camera: &Camera,
        x: f32,
        y: f32,
    ) -> Result<(), String> {
        let Some(drag) = self.drag.take() else {
            return Ok(());
        };
        let result = if drag.selection {
            self.drag_selection(scene, camera, &drag.members, &drag.anchor, x, y)
        } else {
            self.drag(scene, camera, &drag.anchor, x, y)
        };
        self.drag = Some(drag);
        result
    }

    pub fn end_drag(&mut self, cancel: bool) {
        if let Some(drag) = self.drag.take()
            && cancel
        {
            for (id, offset) in drag.members.into_iter().zip(drag.offsets) {
                if offset == Vec3::ZERO {
                    self.offsets.remove(&id);
                } else {
                    self.offsets.insert(id, offset);
                }
            }
        }
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
        self.restoration = None;
        for member in self.members(id) {
            if offset.length_squared() == 0.0 {
                self.offsets.remove(&member);
            } else {
                self.offsets.insert(member, offset);
            }
        }
        Ok(())
    }

    pub fn begin_restore(
        &mut self,
        scene: &Scene,
        id: &str,
        now: f64,
        animate: bool,
    ) -> Result<Vec<String>, String> {
        self.begin_restore_for(scene, id, now, animate, "")
            .map(|(ids, _)| ids)
    }

    pub fn begin_restore_for(
        &mut self,
        scene: &Scene,
        id: &str,
        now: f64,
        animate: bool,
        moving_id: &str,
    ) -> Result<(Vec<String>, Option<bool>), String> {
        self.check_restore_time(now)?;
        if !id.is_empty()
            && !scene
                .parts
                .iter()
                .any(|part| part.active && part.source_id == id)
        {
            return Err("Unknown structure to restore".into());
        }
        let all = id.is_empty() || self.restoration.as_ref().is_some_and(|restore| restore.all);
        let mut ids: HashSet<_> = self
            .restoration
            .iter()
            .flat_map(|restore| restore.offsets.keys().cloned())
            .collect();
        if id.is_empty() {
            ids.extend(self.offsets.keys().cloned());
        } else {
            ids.extend(self.members(id));
        }
        let mut ids: Vec<_> = ids.into_iter().collect();
        ids.sort();
        let offsets: HashMap<_, _> = ids.iter().map(|id| (id.clone(), self.offset(id))).collect();
        let moving = offsets.values().any(|offset| *offset != Vec3::ZERO);
        self.drag = None;
        self.restoration = Some(Restoration {
            started: now,
            previous: now,
            offsets,
            all,
        });
        if animate && moving {
            Ok((ids, None))
        } else {
            Ok((ids, Some(self.finish_restore_for(moving_id))))
        }
    }

    pub fn restoring(&self) -> bool {
        self.restoration.is_some()
    }

    fn check_restore_time(&self, now: f64) -> Result<(), String> {
        if !now.is_finite()
            || now < 0.0
            || self
                .restoration
                .as_ref()
                .is_some_and(|restore| now < restore.previous)
        {
            return Err("Invalid restoration timestamp".into());
        }
        Ok(())
    }

    pub fn advance_restore(&mut self, now: f64) -> Result<bool, String> {
        self.advance_restore_for(now, "")
            .map(|completed| completed.is_none())
    }

    pub fn advance_restore_for(
        &mut self,
        now: f64,
        moving_id: &str,
    ) -> Result<Option<bool>, String> {
        self.check_restore_time(now)?;
        let Some(restore) = self.restoration.as_mut() else {
            return Ok(Some(false));
        };
        restore.previous = now;
        let progress = ((now - restore.started) / 420.0).min(1.0);
        if progress >= 1.0 {
            return Ok(Some(self.finish_restore_for(moving_id)));
        }
        let remaining = (1.0 - progress).powi(3) as f32;
        for (id, offset) in &restore.offsets {
            let offset = *offset * remaining;
            if offset == Vec3::ZERO {
                self.offsets.remove(id);
            } else if let Some(current) = self.offsets.get_mut(id) {
                *current = offset;
            }
        }
        Ok(None)
    }

    pub fn finish_restore(&mut self) {
        self.finish_restore_for("");
    }

    pub fn finish_restore_for(&mut self, moving_id: &str) -> bool {
        let Some(restore) = self.restoration.take() else {
            return false;
        };
        let clear_moving = restore.all || restore.offsets.contains_key(moving_id);
        if restore.all {
            self.clear("");
        } else {
            for id in restore.offsets.keys() {
                self.clear(id);
            }
        }
        clear_moving
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

    pub fn drag_selection(
        &mut self,
        scene: &Scene,
        camera: &Camera,
        ids: &[String],
        anchor: &str,
        x: f32,
        y: f32,
    ) -> Result<(), String> {
        if !x.is_finite() || !y.is_finite() || !ids.iter().any(|id| id == anchor) {
            return Err("Invalid selection drag".into());
        }
        for id in ids {
            if !scene
                .parts
                .iter()
                .any(|part| part.active && part.visible && part.source_id == *id)
            {
                return Err("Unknown or hidden selected structure".into());
            }
        }
        let bounds = scene
            .bounds_for(&[anchor.into()])?
            .ok_or("Unknown structure")?;
        let matrix = camera.matrix();
        let point = matrix * (bounds.center() + self.offset(anchor)).extend(1.0);
        if point.w <= 1e-6 {
            return Ok(());
        }
        let screen = point.truncate() / point.w;
        let inverse = matrix.inverse();
        let delta = inverse.project_point3(screen + Vec3::new(x * 2.0, -y * 2.0, 0.0))
            - inverse.project_point3(screen);
        let limit = scene.bounds.radius() * 3.0;
        if !delta.is_finite()
            || ids
                .iter()
                .any(|id| (self.offset(id) + delta).length() > limit)
        {
            return Ok(());
        }
        self.restoration = None;
        for id in ids {
            let offset = self.offset(id) + delta;
            if offset == Vec3::ZERO {
                self.offsets.remove(id);
            } else {
                self.offsets.insert(id.clone(), offset);
            }
        }
        Ok(())
    }
}
