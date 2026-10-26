use renderer::Scene;
use std::path::Path;

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
    let document: serde_json::Value = serde_json::from_slice(&bytes[20..20 + json_len]).unwrap();
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
    invalid["materials"][0]["extras"]["source_specular"] = serde_json::json!(-0.1);
    assert!(Scene::from_glb(&rebuild(&invalid), &ids).is_err());
    invalid = document.clone();
    invalid["materials"][0]["extras"]["source_subsurface"] = serde_json::json!(1.1);
    assert!(Scene::from_glb(&rebuild(&invalid), &ids).is_err());
    invalid = document.clone();
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
