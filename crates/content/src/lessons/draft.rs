use super::{Files, externalize_lesson_content, externalize_lesson_tables};
use catalog::lesson::{ARCHIVE_LIMIT, JSON_LIMIT};
use serde_json::Value;

pub struct DraftFiles {
    pub metadata: String,
    pub tables: Files,
    pub retained: Files,
    pub content: Files,
}

pub fn prepare_draft(
    mut lesson: Value,
    mut previous: Option<Value>,
    image_bytes: usize,
) -> Result<DraftFiles, String> {
    let (tables, retained) = externalize_lesson_tables(&mut lesson, previous.as_mut())?;
    let content = externalize_lesson_content(&mut lesson)?;
    if content
        .values()
        .chain(tables.values())
        .try_fold(image_bytes, |total, bytes| total.checked_add(bytes.len()))
        .is_none_or(|total| total > ARCHIVE_LIMIT - 4 * 1024 * 1024)
    {
        return Err("Lesson resources exceed 60 MiB".into());
    }
    let metadata = serde_json::to_string(&lesson).map_err(|cause| cause.to_string())?;
    if metadata.len() > JSON_LIMIT {
        return Err("Lesson metadata exceeds 2 MiB".into());
    }
    Ok(DraftFiles {
        metadata,
        tables,
        retained,
        content,
    })
}
