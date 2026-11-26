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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_fields_preserve_explicit_scene_edits() {
        let previous =
            json!({"kind":"observe","modelIds":["bones"],"targetId":"jaw","visibleIds":[]});
        assert_eq!(scene_snapshot_fields(&previous, &previous), None);
        let requested =
            json!({"kind":"text","modelIds":[],"targetId":"jaw","visibleIds":[],"showModel":false});
        assert_eq!(
            scene_snapshot_fields(&previous, &requested).unwrap(),
            ["targetId", "visibleIds", "view"]
        );
        let restored = scene_fields(
            &json!({"targetId":"jaw","sceneRef":"old"}),
            vec!["bones".into()],
        );
        assert_eq!(
            restored,
            json!({"modelIds":["bones"],"targetId":"jaw","visibleIds":null,"view":null,"sceneRef":"old"})
        );
    }

    #[test]
    fn removed_choice_clears_only_its_own_answer() {
        let question = json!({"answerId":"a","choices":[{"id":"a"},{"id":"b"}],"id":"question"});
        assert_eq!(
            remove_choice(question.clone(), "b").unwrap()["answerId"],
            "a"
        );
        assert_eq!(
            remove_choice(question, "a").unwrap(),
            json!({"answerId":"","choices":[{"id":"b"}],"id":"question"})
        );
    }
}
