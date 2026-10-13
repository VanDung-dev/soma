use glam::{Mat3, Mat4, Vec3};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug)]
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
    fn union(self, other: Self) -> Self {
        Self {
            min: self.min.min(other.min),
            max: self.max.max(other.max),
        }
    }
}

pub struct Primitive {
    pub source_id: String,
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    pub bounds: Bounds,
    pub color: [f32; 4],
    pub roughness: f32,
    pub metallic: f32,
    pub double_sided: bool,
    pub blend: bool,
    pub alpha_cutoff: f32,
    pub active: bool,
    pub visible: bool,
}

pub struct Scene {
    pub parts: Vec<Primitive>,
    pub bounds: Bounds,
    pub selected: String,
}

impl Scene {
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

    pub fn from_glb(bytes: &[u8], expected: &[String]) -> Result<Self, String> {
        let gltf = gltf::Gltf::from_slice(bytes).map_err(|e| e.to_string())?;
        let blob = gltf.blob.as_deref().ok_or("GLB has no binary buffer")?;
        // shortcut: static, untextured GLB packages; extend the loader when assets gain textures or animation.
        if gltf
            .buffers()
            .any(|b| !matches!(b.source(), gltf::buffer::Source::Bin) || b.length() > blob.len())
            || gltf.textures().next().is_some()
            || gltf.animations().next().is_some()
            || gltf.skins().next().is_some()
            || gltf.extensions_required().next().is_some()
        {
            return Err("Unsupported GLB: external buffers, textures, skins, animation or required extensions".into());
        }
        for view in gltf.views() {
            if view
                .offset()
                .checked_add(view.length())
                .is_none_or(|end| end > view.buffer().length())
            {
                return Err("Buffer view exceeds binary buffer".into());
            }
        }
        for accessor in gltf.accessors() {
            let view = accessor.view().ok_or("Accessor has no buffer view")?;
            let stride = view.stride().unwrap_or(accessor.size());
            let end = accessor
                .count()
                .saturating_sub(1)
                .checked_mul(stride)
                .and_then(|offset| offset.checked_add(accessor.offset()))
                .and_then(|offset| offset.checked_add(accessor.size()));
            if accessor.sparse().is_some()
                || accessor.count() == 0
                || stride < accessor.size()
                || end.is_none_or(|end| end > view.length())
            {
                return Err("Invalid or unsupported accessor bounds".into());
            }
        }
        let mut parts = Vec::new();
        let scene = gltf
            .default_scene()
            .or_else(|| gltf.scenes().next())
            .ok_or("GLB has no scene")?;
        for node in scene.nodes() {
            load_node(
                node,
                Mat4::IDENTITY,
                None,
                blob,
                &mut HashSet::new(),
                &mut parts,
            )?;
        }
        let identities: HashSet<_> = parts.iter().map(|p| p.source_id.as_str()).collect();
        let expected_ids: HashSet<_> = expected.iter().map(String::as_str).collect();
        if parts.is_empty() || expected_ids.len() != expected.len() || identities != expected_ids {
            return Err("Geometry and metadata structure IDs do not match".into());
        }
        let bounds = parts
            .iter()
            .map(|p| p.bounds)
            .reduce(Bounds::union)
            .ok_or("Empty geometry")?;
        if !bounds.radius().is_finite() || bounds.radius() <= 0.0 {
            return Err("Invalid model bounds".into());
        }
        Ok(Self {
            parts,
            bounds,
            selected: String::new(),
        })
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

fn load_node(
    node: gltf::Node<'_>,
    parent: Mat4,
    inherited_id: Option<&str>,
    blob: &[u8],
    path: &mut HashSet<usize>,
    parts: &mut Vec<Primitive>,
) -> Result<(), String> {
    if path.len() >= 128 || !path.insert(node.index()) {
        return Err("Cyclic or excessively deep scene hierarchy".into());
    }
    let transform = parent * Mat4::from_cols_array_2d(&node.transform().matrix());
    if !transform.is_finite() || transform.determinant().abs() < 1e-12 {
        return Err("Invalid node transform".into());
    }
    let extras: serde_json::Value = node
        .extras()
        .as_ref()
        .map(|raw| serde_json::from_str(raw.get()))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let id = extras
        .get("source_id")
        .and_then(|v| v.as_str())
        .or(inherited_id);
    if let Some(mesh) = node.mesh() {
        let id = id
            .filter(|s| !s.is_empty())
            .ok_or("Mesh has no structure ID")?;
        let normal_matrix = Mat3::from_mat4(transform).inverse().transpose();
        for primitive in mesh.primitives() {
            if primitive.mode() != gltf::mesh::Mode::Triangles
                || primitive.morph_targets().next().is_some()
            {
                return Err("Only static triangle geometry is supported".into());
            }
            let reader = primitive.reader(|_| Some(blob));
            let positions: Vec<_> = reader
                .read_positions()
                .ok_or("Missing positions")?
                .collect();
            let normals: Vec<_> = reader.read_normals().ok_or("Missing normals")?.collect();
            if positions.is_empty() || positions.len() != normals.len() {
                return Err("Invalid position/normal counts".into());
            }
            let mut indices: Vec<u32> = reader
                .read_indices()
                .map(|i| i.into_u32().collect())
                .unwrap_or_else(|| (0..positions.len() as u32).collect());
            if indices.is_empty()
                || !indices.len().is_multiple_of(3)
                || indices.iter().any(|&i| i as usize >= positions.len())
            {
                return Err("Invalid triangle indices".into());
            }
            if transform.determinant() < 0.0 {
                for tri in indices.chunks_exact_mut(3) {
                    tri.swap(1, 2);
                }
            }
            let mut bounds = Bounds {
                min: Vec3::splat(f32::INFINITY),
                max: Vec3::splat(f32::NEG_INFINITY),
            };
            let mut vertices = Vec::with_capacity(positions.len() * 6);
            for (p, n) in positions.into_iter().zip(normals) {
                let p = transform.transform_point3(Vec3::from_array(p));
                let n = (normal_matrix * Vec3::from_array(n)).normalize_or_zero();
                if !p.is_finite() || !n.is_finite() || n.length_squared() < 0.5 {
                    return Err("Non-finite positions or invalid normals".into());
                }
                bounds.min = bounds.min.min(p);
                bounds.max = bounds.max.max(p);
                vertices.extend_from_slice(&p.to_array());
                vertices.extend_from_slice(&n.to_array());
            }
            let material = primitive.material();
            let pbr = material.pbr_metallic_roughness();
            parts.push(Primitive {
                source_id: id.into(),
                vertices,
                indices,
                bounds,
                color: pbr.base_color_factor(),
                roughness: pbr.roughness_factor(),
                metallic: pbr.metallic_factor(),
                double_sided: material.double_sided(),
                blend: material.alpha_mode() == gltf::material::AlphaMode::Blend,
                alpha_cutoff: if material.alpha_mode() == gltf::material::AlphaMode::Mask {
                    material.alpha_cutoff().unwrap_or(0.5)
                } else {
                    0.0
                },
                active: true,
                visible: true,
            });
        }
    }
    for child in node.children() {
        load_node(child, transform, id, blob, path, parts)?;
    }
    path.remove(&node.index());
    Ok(())
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn merges_real_packages_and_preserves_world_geometry_materials_and_identity() {
        let folder =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/models/z-anatomy");
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(folder.join("manifest.json")).unwrap()).unwrap();
        let mut scenes = Vec::new();
        let mut originals = std::collections::HashMap::new();
        for model in manifest["models"].as_array().unwrap() {
            let ids: Vec<String> = serde_json::from_value(model["source_ids"].clone()).unwrap();
            let scene = Scene::from_glb(
                &std::fs::read(folder.join(model["file"].as_str().unwrap())).unwrap(),
                &ids,
            )
            .unwrap();
            assert_eq!(scene.visible_count(), ids.len());
            assert_eq!(
                scene.parts.len(),
                model["primitives"].as_u64().unwrap() as usize
            );
            assert!(scene.parts.iter().all(
                |p| p.vertices.len().is_multiple_of(6) && p.color.iter().all(|v| v.is_finite())
            ));
            if model["file"] == "muscular-system.glb" {
                assert!(scene.parts.iter().any(|p| p.blend && p.color[3] < 1.0));
            }
            for part in &scene.parts {
                if let Some(vertices) = originals.get(&part.source_id) {
                    assert_eq!(
                        &part.vertices, vertices,
                        "Shared structure moved between systems: {}",
                        part.source_id
                    );
                } else {
                    originals.insert(part.source_id.clone(), part.vertices.clone());
                }
            }
            scenes.push(scene);
        }
        let mut scene = Scene::merge(scenes).unwrap();
        assert_eq!(scene.visible_count(), 3874);
        let bounds = scene.bounds;
        let id = scene.parts[0].source_id.clone();
        scene.select(&id).unwrap();
        scene.set_visibility(&[]).unwrap();
        assert_eq!(scene.visible_count(), 0);
        assert!(scene.selected.is_empty());
        assert!(scene.set_visibility(&["unknown".into()]).is_err());
        assert_eq!(scene.visible_count(), 0);
        assert!(scene.set_visibility(&[id.clone(), id.clone()]).is_err());
        scene.set_visibility(&[id]).unwrap();
        assert_eq!(scene.visible_count(), 1);
        let ids: Vec<_> = originals.keys().cloned().collect();
        scene.set_visibility(&ids).unwrap();
        assert_eq!(scene.visible_count(), 3874);
        assert_eq!(scene.bounds.min, bounds.min);
        assert_eq!(scene.bounds.max, bounds.max);
        for part in &scene.parts {
            assert_eq!(part.vertices, originals[&part.source_id]);
        }
        assert!(Scene::merge(Vec::new()).is_err());
    }

    #[test]
    fn scopes_selection_and_inspection_to_the_current_category() {
        let folder =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/models/z-anatomy");
        let meta: serde_json::Value = serde_json::from_slice(
            &std::fs::read(folder.join("cardiovascular-system.json")).unwrap(),
        )
        .unwrap();
        let ids: Vec<_> = meta["structures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["source_id"].as_str().unwrap().to_string())
            .collect();
        let bytes = std::fs::read(folder.join("cardiovascular-system.glb")).unwrap();
        assert!(Scene::from_glb(&bytes, &ids[..1]).is_err());
        assert!(Scene::from_glb(b"bad GLB", &ids).is_err());
        let mut scene = Scene::from_glb(&bytes, &ids).unwrap();
        let scoped = ids[..2].to_vec();
        scene.subset(&scoped).unwrap();
        assert_eq!(scene.visible_count(), 2);
        assert!(scene.select(&ids[2]).is_err());
        scene.select(&ids[0]).unwrap();
        scene.inspect("isolate").unwrap();
        assert_eq!(scene.visible_count(), 1);
        scene.inspect("hide").unwrap();
        assert_eq!(scene.visible_count(), 0);
        scene.inspect("focus").unwrap();
        assert_eq!(scene.visible_count(), 1);
        scene.inspect("all").unwrap();
        assert_eq!(scene.visible_count(), 2);
        assert!(scene.subset(&["unknown".into()]).is_err());
        assert_eq!(scene.visible_count(), 2);
        scene.subset(&[]).unwrap();
        assert_eq!(scene.visible_count(), 0);
        assert!(scene.selected.is_empty());
    }

    #[test]
    fn rejects_corrupt_geometry_and_groups_multiple_primitives() {
        let folder =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/models/z-anatomy");
        let bytes = std::fs::read(folder.join("visceral-systems.glb")).unwrap();
        let metadata: serde_json::Value =
            serde_json::from_slice(&std::fs::read(folder.join("visceral-systems.json")).unwrap())
                .unwrap();
        let ids: Vec<String> = metadata["structures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["source_id"].as_str().unwrap().into())
            .collect();
        let json_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
        let document: serde_json::Value =
            serde_json::from_slice(&bytes[20..20 + json_len]).unwrap();
        let accessor = document["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
            .as_u64()
            .unwrap() as usize;
        let view = document["accessors"][accessor]["bufferView"]
            .as_u64()
            .unwrap() as usize;
        let offset = 28
            + json_len
            + document["bufferViews"][view]["byteOffset"]
                .as_u64()
                .unwrap_or(0) as usize
            + document["accessors"][accessor]["byteOffset"]
                .as_u64()
                .unwrap_or(0) as usize;
        let mut corrupt = bytes.clone();
        corrupt[offset..offset + 4].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(
            Scene::from_glb(&corrupt, &ids)
                .err()
                .unwrap()
                .contains("Non-finite")
        );
        let rebuild = |document: &serde_json::Value| {
            let mut json = serde_json::to_vec(document).unwrap();
            while !json.len().is_multiple_of(4) {
                json.push(b' ');
            }
            let mut result = bytes[..12].to_vec();
            let length = (20 + json.len() + bytes.len() - 20 - json_len) as u32;
            result[8..12].copy_from_slice(&length.to_le_bytes());
            result.extend_from_slice(&(json.len() as u32).to_le_bytes());
            result.extend_from_slice(&bytes[16..20]);
            result.extend(json);
            result.extend_from_slice(&bytes[20 + json_len..]);
            result
        };
        let mut invalid = document.clone();
        invalid["accessors"][accessor]["byteOffset"] = serde_json::json!(bytes.len());
        assert!(Scene::from_glb(&rebuild(&invalid), &ids).is_err());
        let mut multiple = document;
        let primitive = multiple["meshes"][0]["primitives"][0].clone();
        multiple["meshes"][0]["primitives"]
            .as_array_mut()
            .unwrap()
            .push(primitive);
        let scene = Scene::from_glb(&rebuild(&multiple), &ids).unwrap();
        let duplicate = Scene::from_glb(&rebuild(&multiple), &ids).unwrap();
        let mut scene = Scene::merge(vec![scene, duplicate]).unwrap();
        let id = scene.parts[0].source_id.clone();
        scene.subset(std::slice::from_ref(&id)).unwrap();
        scene.select(&id).unwrap();
        scene.inspect("isolate").unwrap();
        assert_eq!(scene.parts.iter().filter(|p| p.visible).count(), 2);
        assert_eq!(scene.visible_count(), 1);
        scene.inspect("hide").unwrap();
        assert_eq!(scene.visible_count(), 0);
    }

    #[test]
    fn camera_stays_ten_percent_inside_the_fixed_enclosure() {
        let bounds = Bounds {
            min: Vec3::new(-0.4, 0.0, -0.3),
            max: Vec3::new(0.4, 1.8, 0.3),
        };
        let mut camera = Camera::new(bounds);
        let limit = camera.enclosure_radius() * 0.9;
        let check = |camera: &Camera| {
            assert!(camera.eye().is_finite());
            assert!(camera.matrix().is_finite());
            assert!(camera.eye().distance(bounds.center()) <= limit + limit * 1e-5);
        };
        camera.zoom(f32::MAX).unwrap();
        assert!((camera.eye().distance(bounds.center()) - limit).abs() < 1e-5);
        check(&camera);
        for (x, y) in [(100.0, -100.0), (-100.0, 100.0), (1e10, -1e10)] {
            camera.pan(x, y).unwrap();
            check(&camera);
            for pitch in [-3.0, 0.7, 3.0] {
                camera.rotate(1.2, pitch).unwrap();
                check(&camera);
                camera.zoom(100.0).unwrap();
                check(&camera);
                camera.zoom(0.001).unwrap();
                check(&camera);
            }
        }
        camera.zoom(f32::MAX).unwrap();
        let previous = camera.eye();
        assert!(camera.pan(f32::MAX, f32::MAX).is_err());
        assert_eq!(camera.eye(), previous);
        camera.resize(200, 1600);
        check(&camera);
        camera.reset();
        check(&camera);
        assert!(camera.target.distance(bounds.center()) < 1e-5);
    }

    #[test]
    fn camera_fits_narrow_viewports_and_rejects_invalid_inputs() {
        let bounds = Bounds {
            min: Vec3::splat(-1.0),
            max: Vec3::splat(1.0),
        };
        let mut camera = Camera::new(bounds);
        let initial_yaw = camera.yaw;
        let initial_pitch = camera.pitch;
        let wide_distance = camera.distance;
        camera.resize(390, 480);
        assert!(camera.distance > wide_distance);
        camera.rotate(0.5, 100.0).unwrap();
        assert!(camera.matrix().is_finite());
        assert!(camera.zoom(0.0).is_err());
        assert!(camera.rotate(f32::NAN, 0.0).is_err());
        assert!(camera.pan(f32::INFINITY, 0.0).is_err());
        camera.reset();
        assert_eq!(camera.yaw, initial_yaw);
        assert_eq!(camera.pitch, initial_pitch);
        assert!(camera.eye().x < camera.target.x);
        assert!(camera.eye().y > camera.target.y);
        let check_frame = |camera: &Camera| {
            let center = camera.matrix().project_point3(camera.target);
            assert!(center.x.abs() < 1e-5);
            assert!((center.y - 0.04).abs() < 1e-5);
        };
        check_frame(&camera);
        camera.rotate(0.6, -0.3).unwrap();
        camera.zoom(0.8).unwrap();
        camera.pan(0.1, -0.2).unwrap();
        check_frame(&camera);
    }
}
