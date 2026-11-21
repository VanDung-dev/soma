pub struct ModelFixture {
    pub gltf: gltf::Gltf,
    document: gltf::json::Root,
    pub bundle: serde_json::Value,
}

impl ModelFixture {
    pub fn new() -> Self {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/web/public/models/z-anatomy/z-anatomy.glb.br");
        let gltf = renderer::read_glb(&std::fs::read(&path).unwrap()).unwrap();
        let document = gltf.document.as_json().clone();
        let bundle =
            serde_json::from_slice(&std::fs::read(path.with_file_name("z-anatomy.json")).unwrap())
                .unwrap();
        Self {
            gltf,
            document,
            bundle,
        }
    }

    pub fn metadata(&self, name: &str) -> serde_json::Value {
        let model = self.bundle["manifest"]["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|model| model["file"] == format!("{name}.glb"))
            .unwrap();
        self.bundle["metadata"][model["root_id"].as_str().unwrap()].clone()
    }

    pub fn select(&mut self, name: &str) -> Vec<String> {
        let ids: Vec<String> = self.metadata(name)["structures"]
            .as_array()
            .unwrap()
            .iter()
            .map(|part| part["source_id"].as_str().unwrap().to_owned())
            .collect();
        let mut document = self.document.clone();
        let scene = document.scene.as_ref().unwrap().value();
        document.scenes[scene].nodes.retain(|index| {
            let extras: serde_json::Value =
                serde_json::from_str(document.nodes[index.value()].extras.as_ref().unwrap().get())
                    .unwrap();
            ids.iter().any(|id| extras["source_id"] == *id)
        });
        self.gltf.document = gltf::Document::from_json(document).unwrap();
        ids
    }

    pub fn bytes(&self) -> Vec<u8> {
        let mut json = serde_json::to_vec(self.gltf.document.as_json()).unwrap();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let bin = self.gltf.blob.as_ref().unwrap();
        let mut bytes = b"glTF".to_vec();
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&((28 + json.len() + bin.len()) as u32).to_le_bytes());
        bytes.extend_from_slice(&(json.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"JSON");
        bytes.extend_from_slice(&json);
        bytes.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"BIN\0");
        bytes.extend_from_slice(bin);
        bytes
    }
}
