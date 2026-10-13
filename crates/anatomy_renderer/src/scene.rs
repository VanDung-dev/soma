use crate::{Bounds, Primitive};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    pub parts: Vec<Primitive>,
    pub bounds: Bounds,
    pub selected: String,
}

impl Scene {
    /// Return incoming primitive indices so GPU draw ranges stay paired after deduplication.
    pub fn append(&mut self, incoming: Self) -> Vec<usize> {
        let known: HashSet<_> = self.parts.iter().map(|p| p.source_id.clone()).collect();
        let mut added = Vec::new();
        for (index, part) in incoming.parts.into_iter().enumerate() {
            if !known.contains(&part.source_id) {
                self.bounds = self.bounds.union(part.bounds);
                self.parts.push(part);
                added.push(index);
            }
        }
        added
    }

    pub fn merge(scenes: Vec<Self>) -> Result<Self, String> {
        let mut known = HashSet::new();
        let mut parts = Vec::new();
        for scene in scenes {
            let ids: HashSet<_> = scene.parts.iter().map(|p| p.source_id.clone()).collect();
            // A structure can belong to several systems; keep all its primitives only once.
            parts.extend(
                scene
                    .parts
                    .into_iter()
                    .filter(|p| !known.contains(&p.source_id)),
            );
            known.extend(ids);
        }
        let bounds = parts
            .iter()
            .map(|p| p.bounds)
            .reduce(Bounds::union)
            .ok_or("Empty geometry")?;
        Ok(Self {
            parts,
            bounds,
            selected: String::new(),
        })
    }

    pub fn set_visibility(&mut self, ids: &[String]) -> Result<(), String> {
        let visible: HashSet<_> = ids.iter().map(String::as_str).collect();
        let known: HashSet<_> = self
            .parts
            .iter()
            .filter(|p| p.active)
            .map(|p| p.source_id.as_str())
            .collect();
        if visible.len() != ids.len() || !visible.is_subset(&known) {
            return Err("Unknown or duplicate visible structure ID".into());
        }
        for part in &mut self.parts {
            part.visible = part.active && visible.contains(part.source_id.as_str());
        }
        if !visible.contains(self.selected.as_str()) {
            self.selected.clear();
        }
        Ok(())
    }

    pub fn change_visibility(&mut self, ids: &[String], shown: bool) -> Result<(), String> {
        let changed: HashSet<_> = ids.iter().map(String::as_str).collect();
        let known: HashSet<_> = self
            .parts
            .iter()
            .filter(|p| p.active)
            .map(|p| p.source_id.as_str())
            .collect();
        if changed.len() != ids.len() || !changed.is_subset(&known) {
            return Err("Unknown or duplicate visible structure ID".into());
        }
        for part in &mut self.parts {
            if changed.contains(part.source_id.as_str()) {
                part.visible = shown;
            }
        }
        if !shown && changed.contains(self.selected.as_str()) {
            self.selected.clear();
        }
        Ok(())
    }

    pub fn subset(&mut self, ids: &[String]) -> Result<Option<Bounds>, String> {
        let active: HashSet<_> = ids.iter().map(String::as_str).collect();
        let known: HashSet<_> = self.parts.iter().map(|p| p.source_id.as_str()).collect();
        if active.len() != ids.len() || !active.is_subset(&known) {
            return Err("Unknown or duplicate subset structure ID".into());
        }
        self.selected.clear();
        for part in &mut self.parts {
            part.active = active.contains(part.source_id.as_str());
            part.visible = part.active;
        }
        Ok(self.active_bounds())
    }

    pub fn select(&mut self, id: &str) -> Result<(), String> {
        if !id.is_empty() && !self.parts.iter().any(|p| p.active && p.source_id == id) {
            return Err("Selection is outside the current category".into());
        }
        self.selected = id.into();
        Ok(())
    }

    pub fn inspect(&mut self, action: &str) -> Result<Option<Bounds>, String> {
        match action {
            "all" => {
                for p in &mut self.parts {
                    p.visible = p.active;
                }
                Ok(self.active_bounds())
            }
            "focus" | "isolate" | "hide" => {
                if self.selected.is_empty() {
                    return Ok(None);
                }
                for p in &mut self.parts {
                    if action == "isolate" {
                        p.visible = p.active && p.source_id == self.selected;
                    } else if p.source_id == self.selected {
                        p.visible = action != "hide";
                    }
                }
                Ok((action != "hide")
                    .then(|| {
                        self.parts
                            .iter()
                            .filter(|p| p.source_id == self.selected)
                            .map(|p| p.bounds)
                            .reduce(Bounds::union)
                    })
                    .flatten())
            }
            _ => Err("Unknown inspection action".into()),
        }
    }

    pub fn active_bounds(&self) -> Option<Bounds> {
        self.parts
            .iter()
            .filter(|p| p.active)
            .map(|p| p.bounds)
            .reduce(Bounds::union)
    }
    pub fn visible_count(&self) -> usize {
        self.parts
            .iter()
            .filter(|p| p.visible)
            .map(|p| &p.source_id)
            .collect::<HashSet<_>>()
            .len()
    }
}
