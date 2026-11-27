use catalog::lesson::editing::{remove_choice, scene_fields, scene_snapshot_fields};
use serde_json::json;

#[test]
fn snapshot_fields_preserve_explicit_scene_edits() {
    let previous = json!({"kind":"observe","modelIds":["bones"],"targetId":"jaw","visibleIds":[]});
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
