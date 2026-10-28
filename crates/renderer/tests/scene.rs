use renderer::Scene;
use std::path::Path;

#[test]
fn merges_real_packages_and_preserves_world_geometry_materials_and_identity() {
    let folder =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/models/z-anatomy");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(folder.join("manifest.json")).unwrap()).unwrap();
    let mut scenes = Vec::new();
    let mut streamed: Option<Scene> = None;
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
        assert!(
            scene.parts.iter().all(
                |p| p.vertices.len().is_multiple_of(6) && p.color.iter().all(|v| v.is_finite())
            )
        );
        if model["file"] == "muscular-system.glb.br" {
            assert!(scene.parts.iter().any(|p| p.blend && p.color[3] < 1.0));
        }
        let mut package = std::collections::HashMap::<_, Vec<_>>::new();
        for part in &scene.parts {
            package
                .entry(part.source_id.clone())
                .or_default()
                .push((part.color, part.vertices.clone()));
        }
        for (id, primitives) in package {
            if let Some(expected) = originals.get(&id) {
                assert!(
                    &primitives == expected,
                    "Shared structure changed between systems: {id}"
                );
            } else {
                originals.insert(id, primitives);
            }
        }
        let incoming: Scene =
            serde_json::from_str(&serde_json::to_string(&scene).unwrap()).unwrap();
        if let Some(streamed) = &mut streamed {
            let before = streamed.parts.len();
            let added = streamed.append(incoming);
            assert_eq!(streamed.parts.len(), before + added.len());
            for (part, index) in streamed.parts[before..].iter().zip(added) {
                assert_eq!(part.source_id, scene.parts[index].source_id);
                assert_eq!(part.bounds.min, scene.parts[index].bounds.min);
            }
        } else {
            streamed = Some(incoming);
        }
        scenes.push(scene);
    }
    let mut scene = Scene::merge(scenes).unwrap();
    assert_eq!(scene.visible_count(), 3874);
    let mut streamed = streamed.unwrap();
    assert_eq!(streamed.visible_count(), scene.visible_count());
    assert_eq!(streamed.bounds.min, scene.bounds.min);
    assert_eq!(streamed.bounds.max, scene.bounds.max);
    assert_eq!(
        streamed
            .parts
            .iter()
            .map(|p| &p.source_id)
            .collect::<Vec<_>>(),
        scene.parts.iter().map(|p| &p.source_id).collect::<Vec<_>>()
    );
    let duplicate: Scene = serde_json::from_str(&serde_json::to_string(&scene).unwrap()).unwrap();
    streamed.set_visibility(&[]).unwrap();
    assert!(streamed.append(duplicate).is_empty());
    assert_eq!(streamed.visible_count(), 0);
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
        assert!(
            originals[&part.source_id]
                .iter()
                .any(|(color, vertices)| *color == part.color && *vertices == part.vertices)
        );
    }
    assert!(Scene::merge(Vec::new()).is_err());
}

#[test]
fn scopes_selection_and_inspection_to_the_current_category() {
    let folder =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/models/z-anatomy");
    let meta: serde_json::Value =
        serde_json::from_slice(&std::fs::read(folder.join("cardiovascular-system.json")).unwrap())
            .unwrap();
    let ids: Vec<_> = meta["structures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["source_id"].as_str().unwrap().to_string())
        .collect();
    let bytes = std::fs::read(folder.join("cardiovascular-system.glb.br")).unwrap();
    assert!(Scene::from_glb(&bytes, &ids[..1]).is_err());
    assert!(Scene::from_glb(b"bad GLB", &ids).is_err());
    let mut scene = Scene::from_glb(&bytes, &ids).unwrap();
    let scoped = ids[..2].to_vec();
    scene.subset(&scoped).unwrap();
    assert_eq!(scene.visible_count(), 2);
    assert!(scene.select(&ids[2]).is_err());
    assert!(scene.bounds_for(&[ids[2].clone()]).is_err());
    assert!(scene.bounds_for(&[ids[0].clone(), ids[0].clone()]).is_err());
    assert!(scene.bounds_for(&[]).unwrap().is_none());
    scene.select(&ids[0]).unwrap();
    scene.change_visibility(&[ids[0].clone()], false).unwrap();
    assert_eq!(scene.visible_count(), 1);
    assert!(scene.selected.is_empty());
    let focused_bounds = scene.bounds_for(&scoped).unwrap().unwrap();
    let parts: Vec<_> = scene.parts.iter().filter(|p| p.active).collect();
    assert_eq!(
        focused_bounds.min,
        parts
            .iter()
            .fold(parts[0].bounds.min, |v, p| v.min(p.bounds.min))
    );
    assert_eq!(
        focused_bounds.max,
        parts
            .iter()
            .fold(parts[0].bounds.max, |v, p| v.max(p.bounds.max))
    );
    assert_eq!(
        scene.visible_count(),
        1,
        "Computing focus bounds must not mutate visibility"
    );
    scene.select(&ids[1]).unwrap();
    assert!(
        scene
            .change_visibility(&[ids[1].clone(), "unknown".into()], false)
            .is_err()
    );
    assert!(
        scene
            .change_visibility(&[ids[1].clone(), ids[1].clone()], false)
            .is_err()
    );
    assert!(scene.change_visibility(&[ids[2].clone()], true).is_err());
    assert_eq!(scene.visible_count(), 1);
    assert_eq!(scene.selected, ids[1]);
    scene.change_visibility(&[ids[0].clone()], true).unwrap();
    assert_eq!(scene.visible_count(), 2);
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
