use renderer::Scene;
use std::io::Read;
use std::path::Path;

#[test]
fn rejects_brotli_with_invalid_block_switch() {
    let bytes = [
        0x20, 0x00, 0x10, 0x41, 0x41, 0x41, 0xfc, 0xff, 0xff, 0x07, 0x00, 0x22, 0x28, 0xf0, 0x0b,
        0x60, 0xf7, 0xf4, 0x1f, 0x00, 0x00, 0x00,
    ];
    assert!(Scene::from_glb(&bytes, &[]).is_err());
}

#[test]
fn rejects_corrupt_geometry_and_groups_multiple_primitives() {
    let folder =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/public/models/z-anatomy");
    let compressed = std::fs::read(folder.join("visceral-systems.glb.br")).unwrap();
    let mut bytes = Vec::new();
    brotli_decompressor::Decompressor::new(compressed.as_slice(), 4096)
        .read_to_end(&mut bytes)
        .unwrap();
    let metadata: serde_json::Value =
        serde_json::from_slice(&std::fs::read(folder.join("visceral-systems.json")).unwrap())
            .unwrap();
    let ids: Vec<String> = metadata["structures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["source_id"].as_str().unwrap().into())
        .collect();
    let raw = Scene::from_glb(&bytes, &ids).unwrap();
    let decoded = Scene::from_glb(&compressed, &ids).unwrap();
    assert_eq!(raw.parts.len(), decoded.parts.len());
    for (raw, decoded) in raw.parts.iter().zip(&decoded.parts) {
        assert_eq!(raw.source_id, decoded.source_id);
        assert_eq!(raw.vertices, decoded.vertices);
        assert_eq!(raw.indices, decoded.indices);
        assert_eq!(raw.color, decoded.color);
    }
    assert!(Scene::from_glb(&compressed[..compressed.len() / 2], &ids).is_err());
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

#[test]
fn rejects_brotli_models_exceeding_the_decoded_size_limit() {
    let bytes = include_bytes!("fixtures/oversized.glb.br");
    assert!(
        Scene::from_glb(bytes, &[])
            .err()
            .unwrap()
            .contains("128 MiB")
    );
}
