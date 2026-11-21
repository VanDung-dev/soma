use super::Files;
use catalog::lesson::{self, ARCHIVE_LIMIT};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const QUESTION_COUNT_LIMIT: usize = 2048;

fn question_reference(step: &str, bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(step);
    hash.update([0]);
    hash.update(bytes);
    format!("{:x}", hash.finalize())
}

fn lesson_question_references(lesson: &Value) -> BTreeSet<&str> {
    lesson["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|step| {
            step["questionRef"]
                .as_str()
                .filter(|reference| lesson::section_reference(reference))
        })
        .collect()
}

pub fn externalize_lesson_questions(lesson: &mut Value) -> Result<Files, String> {
    let mut files = Files::new();
    for step in lesson["steps"].as_array_mut().unwrap() {
        let step = step.as_object_mut().unwrap();
        if step.contains_key("questionRef") {
            continue;
        }
        let Some(Value::Array(questions)) = step.remove("questions") else {
            continue;
        };
        let mut bytes = Vec::new();
        for record in questions {
            serde_json::to_writer(&mut bytes, &record).map_err(|cause| cause.to_string())?;
            bytes.push(b'\n');
        }
        if bytes.len() > ARCHIVE_LIMIT {
            return Err("Lesson question file exceeds 64 MiB".into());
        }
        let reference = question_reference(step.get("id").and_then(Value::as_str).unwrap(), &bytes);
        step.insert("questionRef".into(), Value::String(reference.clone()));
        files.insert(reference, bytes);
    }
    if lesson_question_references(lesson).len() > QUESTION_COUNT_LIMIT {
        return Err("Lesson question file limit exceeded".into());
    }
    Ok(files)
}

fn read_questions(bytes: &[u8]) -> Option<Value> {
    let records = std::str::from_utf8(bytes)
        .ok()?
        .lines()
        .map(serde_json::from_str)
        .collect::<Result<_, _>>()
        .ok()?;
    let questions = Value::Array(records);
    lesson::questions(&questions, false).then_some(questions)
}

pub fn hydrate_lesson_questions(lesson: &mut Value, files: Files) -> Vec<String> {
    let mut missing = Vec::new();
    for step in lesson
        .get_mut("steps")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object_mut)
    {
        let Some(reference) = step
            .get("questionRef")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        let questions = files
            .get(&reference)
            .filter(|bytes| {
                step.get("id").and_then(Value::as_str).is_some_and(|id| {
                    bytes.len() <= ARCHIVE_LIMIT && question_reference(id, bytes) == reference
                })
            })
            .and_then(|bytes| read_questions(bytes));
        step.remove("questions");
        if let Some(questions) = questions {
            step.insert("questions".into(), questions);
            step.remove("questionRef");
        } else {
            missing.push(reference);
        }
    }
    missing
}
