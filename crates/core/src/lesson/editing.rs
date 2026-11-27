use serde_json::{Value, json};

pub const SCENE_FIELDS: [&str; 4] = ["modelIds", "targetId", "visibleIds", "view"];

pub fn scene_fields(scene: &Value, model_ids: Vec<String>) -> Value {
    json!({
        "modelIds": model_ids,
        "targetId": scene["targetId"].as_str().unwrap_or_default(),
        "visibleIds": scene["visibleIds"],
        "view": scene["view"],
        "sceneRef": scene["sceneRef"].as_str(),
    })
}

pub fn scene_snapshot_fields(previous: &Value, requested: &Value) -> Option<Vec<&'static str>> {
    let mut fields: Vec<_> = SCENE_FIELDS
        .into_iter()
        .filter(|field| previous.get(*field) == requested.get(*field))
        .collect();
    if fields.len() == SCENE_FIELDS.len() && previous.get("showModel") == requested.get("showModel")
    {
        return None;
    }
    if previous["kind"] == requested["kind"] {
        fields.push("kind");
    }
    Some(fields)
}

pub fn remove_choice(mut question: Value, choice_id: &str) -> Result<Value, &'static str> {
    let choices = question["choices"]
        .as_array_mut()
        .ok_or("Invalid lesson question choices")?;
    choices.retain(|choice| choice["id"].as_str() != Some(choice_id));
    if question["answerId"].as_str() == Some(choice_id) {
        question["answerId"] = Value::String(String::new());
    }
    Ok(question)
}
