use super::{CatalogData, TargetView};
use serde::Deserialize;
use std::collections::{HashSet, VecDeque};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonSceneSelection {
    target_id: String,
    model_ids: Option<Vec<String>>,
    visible_ids: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum LessonStepSelection {
    Text,
    Observe(LessonSceneSelection),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonModelSelection {
    model_id: String,
    model_ids: Option<Vec<String>>,
    preload_model_ids: Option<Vec<String>>,
    scene: Option<LessonSceneSelection>,
    steps: Vec<LessonStepSelection>,
}

impl CatalogData {
    pub fn lesson_scene_visible_ids<'a>(
        &'a self,
        scene: Option<&'a LessonSceneSelection>,
    ) -> &'a [String] {
        scene
            .and_then(|scene| {
                scene
                    .visible_ids
                    .as_deref()
                    .or_else(|| self.members(&scene.target_id))
            })
            .unwrap_or_default()
    }

    pub fn lesson_scene_models<'a>(
        &'a self,
        model_id: &'a str,
        model_ids: &'a [String],
        scene: Option<&'a LessonSceneSelection>,
    ) -> Vec<&'a str> {
        if let Some(models) = scene.and_then(|scene| scene.model_ids.as_deref()) {
            return models.iter().map(String::as_str).collect();
        }

        let mut models: Vec<_> = model_ids.iter().map(String::as_str).collect();
        if models.is_empty() && !model_id.is_empty() {
            models.push(model_id);
        }

        let mut needed: HashSet<_> = self
            .lesson_scene_visible_ids(scene)
            .iter()
            .map(String::as_str)
            .collect();
        for model in &models {
            for id in self.members(model).unwrap_or_default() {
                needed.remove(id.as_str());
            }
        }
        for target in &self.catalog.targets {
            if needed.is_empty() {
                break;
            }
            let Some(model) = &target.model else { continue };
            if !models.contains(&target.id.as_str())
                && model
                    .structure_ids
                    .iter()
                    .any(|id| needed.contains(id.as_str()))
            {
                models.push(&target.id);
                for id in &model.structure_ids {
                    needed.remove(id.as_str());
                }
            }
        }
        models
    }

    pub fn lesson_models<'a>(&'a self, lesson: &'a LessonModelSelection) -> Vec<&'a str> {
        let model_ids = lesson.model_ids.as_deref().unwrap_or_default();
        let steps = lesson.steps.iter().filter_map(|step| match step {
            LessonStepSelection::Text => None,
            LessonStepSelection::Observe(scene) => Some(scene),
        });
        let mut seen = HashSet::new();
        lesson
            .preload_model_ids
            .iter()
            .flatten()
            .map(String::as_str)
            .chain(self.lesson_scene_models(&lesson.model_id, model_ids, None))
            .chain(lesson.scene.iter().chain(steps).flat_map(|scene| {
                self.lesson_scene_models(&lesson.model_id, model_ids, Some(scene))
            }))
            .filter(|id| seen.insert(*id))
            .collect()
    }

    pub fn lesson_targets(&self, model_ids: &[String]) -> Vec<TargetView<'_>> {
        let roots = model_ids
            .iter()
            .filter_map(|id| self.targets.get(id).copied())
            .filter(|index| self.roots.contains(index));
        let mut targets = Vec::new();
        for root in roots {
            let mut pending = VecDeque::from([root]);
            while let Some(index) = pending.pop_front() {
                if !Self::ids(&self.catalog.targets[index]).is_empty() {
                    targets.push(self.target_at(index));
                }
                pending.extend(self.children[index].iter().copied());
            }
        }
        targets
    }

    fn lesson_target_available(&self, model_ids: &[&str], target_id: &str) -> bool {
        let Some(mut index) = self.targets.get(target_id).copied() else {
            return false;
        };
        if Self::ids(&self.catalog.targets[index]).is_empty() {
            return false;
        }
        while let Some(parent) = &self.catalog.targets[index].parent_id {
            index = self.targets[parent];
        }
        model_ids.contains(&self.catalog.targets[index].id.as_str())
    }

    pub fn edit_lesson_scene_visibility(
        &self,
        mut model_ids: Vec<String>,
        target_id: &str,
        visible_ids: Vec<String>,
        root: Option<(&str, bool)>,
    ) -> (Vec<String>, String) {
        if let Some((id, shown)) = root {
            if shown {
                model_ids.push(id.into());
                let mut seen = HashSet::new();
                model_ids.retain(|id| seen.insert(id.clone()));
            } else {
                model_ids.retain(|model| model.as_str() != id);
            }
        }
        let scene = LessonSceneSelection {
            target_id: target_id.into(),
            model_ids: None,
            visible_ids: Some(visible_ids),
        };
        let models = self.lesson_scene_models("", &model_ids, Some(&scene));
        let target = if !target_id.is_empty()
            && (root.is_none_or(|(_, shown)| shown)
                || self.lesson_target_available(&models, target_id))
        {
            target_id
        } else {
            models.first().copied().unwrap_or_default()
        };
        (
            models.into_iter().map(str::to_owned).collect(),
            target.into(),
        )
    }
}
