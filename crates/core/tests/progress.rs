use catalog::lesson::progress::{Action, Progress, Step};
use serde_json::{Value, json};
use std::collections::HashSet;

fn steps() -> Vec<Step> {
    serde_json::from_value(json!([
        {"id":"intro","questions":[]},
        {"id":"quiz","questions":[{"id":"q","answerId":"correct"}]},
        {"id":"end","mode":"content","questions":[{"id":"ignored","answerId":"x"}]}
    ]))
    .unwrap()
}

fn playback_json(
    progress: &Progress,
    steps: &[Step],
    issues: &HashSet<String>,
    preview: bool,
) -> Value {
    serde_json::to_value(progress.playback(steps, issues, preview)).unwrap()
}

#[test]
fn locks_ahead_of_reading_or_answers_and_resumes_at_the_boundary() {
    let steps = steps();
    let progress = Progress::from_storage(Some(
        r#"{"position":"removed","read":["intro","quiz","end"]}"#,
    ));
    let state = playback_json(&progress, &steps, &HashSet::new(), false);
    assert_eq!(state["index"], 1);
    assert_eq!(state["reading"], false);
    assert_eq!(state["awaitingAnswers"], true);
    assert_eq!(state["nextLocked"], true);
    assert_eq!(state["rows"][2]["locked"], true);
    assert_eq!(state["readingDurationMs"], 15_000);

    let progress = progress
        .update(
            None,
            Action::Answer {
                step_id: "quiz".into(),
                question_id: "q".into(),
                answer_id: "correct".into(),
                choice_id: "correct".into(),
            },
        )
        .unwrap();
    let state = playback_json(&progress, &steps, &HashSet::new(), false);
    assert_eq!(state["awaitingAnswers"], false);
    assert_eq!(state["nextLocked"], false);
    assert_eq!(state["correctQuestions"], json!(["q"]));

    let progress = progress.update(None, Action::Finish).unwrap();
    let state = playback_json(&progress, &steps, &HashSet::new(), false);
    assert_eq!(state["complete"], true);
    assert_eq!(state["index"], 2);
    let issues = HashSet::from(["intro".into()]);
    let state = playback_json(&progress, &steps, &issues, false);
    assert_eq!(state["index"], 0);
    assert_eq!(state["complete"], false);
    assert_eq!(state["reading"], false);
    assert_eq!(state["nextLocked"], true);
}

#[test]
fn merges_read_and_answer_records_and_keeps_missing_position_distinct_from_completion() {
    let current = Progress::from_storage(Some(
        r#"{"read":["quiz",3],"answers":{"quiz/q":"stale","invalid":false}}"#,
    ));
    let saved = Progress::from_storage(Some(
        r#"{"position":null,"read":["intro","quiz"],"answers":{"quiz/q":"correct"}}"#,
    ));
    let progress = current
        .update(
            Some(saved),
            Action::Read {
                step_id: "end".into(),
            },
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(progress).unwrap(),
        json!({"position":"end","read":["intro","quiz","end"],"answers":{"quiz/q":"correct"}})
    );
    assert_eq!(
        serde_json::to_value(Progress::from_storage(Some(r#"{"position":null}"#))).unwrap()["position"],
        Value::Null
    );
    assert!(
        serde_json::to_value(Progress::from_storage(Some("invalid")))
            .unwrap()
            .get("position")
            .is_none()
    );
}

#[test]
fn preview_keeps_read_markers_without_persisted_answers_or_navigation_locks() {
    let steps = steps();
    let progress =
        Progress::from_storage(Some(r#"{"read":["intro"],"answers":{"quiz/q":"correct"}}"#))
            .preview(Some("quiz".into()));
    let state = playback_json(&progress, &steps, &HashSet::from(["quiz".into()]), true);
    assert_eq!(state["index"], 1);
    assert_eq!(state["rows"][0]["read"], true);
    assert_eq!(state["rows"][2]["locked"], false);
    assert_eq!(state["reading"], false);
    assert_eq!(state["correctQuestions"], json!([]));
    assert!(
        progress
            .update(
                None,
                Action::Answer {
                    step_id: "quiz".into(),
                    question_id: "q".into(),
                    answer_id: "correct".into(),
                    choice_id: "incorrect".into(),
                }
            )
            .is_none()
    );
}
