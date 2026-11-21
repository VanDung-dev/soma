use crate::storage::{read_file, write_file, write_file_with_overwrite};
use catalog::lesson::{self, IMAGE_LIMIT, JSON_LIMIT};
use content::lessons::{check_file, check_image_collection, image_info};
use percent_encoding::percent_decode_str;
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    collections::{BTreeSet, HashSet},
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};
use tauri::{
    AppHandle, Manager, Window,
    ipc::{InvokeBody, Request, Response},
};
use tauri_plugin_dialog::DialogExt;

fn store(app: &AppHandle) -> Result<(PathBuf, File), String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(message)?
        .join("lessons");
    fs::create_dir_all(&root).map_err(message)?;
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(".lock"))
        .map_err(message)?;
    lock.lock().map_err(message)?;
    Ok((root, lock))
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn directory(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{:x}", Sha256::digest(id.as_bytes())))
}

fn current_lesson(path: &Path) -> io::Result<Option<String>> {
    match read_file(path, JSON_LIMIT) {
        Ok(bytes) => {
            let mut lesson: serde_json::Value = serde_json::from_slice(&bytes)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            let mut contents = content::lessons::Files::new();
            for content_path in content::lessons::lesson_content_paths(&lesson) {
                match read_file(
                    &path.parent().unwrap_or(path).join(&content_path),
                    content::lessons::CONTENT_LIMIT,
                ) {
                    Ok(bytes) => {
                        contents.insert(content_path, bytes);
                    }
                    Err(error)
                        if error.kind() == io::ErrorKind::NotFound
                            || error.kind() == io::ErrorKind::InvalidData =>
                    {
                        eprintln!("Could not read lesson text block {}: {error}", content_path);
                    }
                    Err(error) => return Err(error),
                }
            }
            let missing =
                content::lessons::hydrate_lesson_content_recovering(&mut lesson, contents);
            if !missing.is_empty() {
                eprintln!(
                    "Could not read lesson text content in {}: {missing:?}",
                    path.display()
                );
            }
            let mut sections = content::lessons::Files::new();
            for name in content::lessons::lesson_table_paths(&lesson) {
                if let Ok(bytes) = read_file(
                    &path.parent().unwrap_or(path).join(name),
                    content::lessons::DRAFT_TABLE_LIMIT,
                ) {
                    sections.insert(name.into(), bytes);
                }
            }
            let missing = content::lessons::hydrate_lesson_tables(&mut lesson, sections)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            if !missing.is_empty() {
                eprintln!(
                    "Could not read lesson section files in {}: {missing:?}",
                    path.display()
                );
            }
            serde_json::to_string(&lesson)
                .map(Some)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn saved_lesson_recovers_scene_and_question_files_independently() {
        let directory = tempfile::tempdir().unwrap();
        let title = json!({"vi":"Cảnh 3D","en":""});
        let mut lesson = json!({"id":"scene-recovery","version":1,"title":title,"summary":title,"modelId":"",
        "steps":[
            {"id":"first","kind":"observe","title":title,"instruction":title,"targetId":"bones","modelIds":["bones"]},
            {"id":"second","kind":"observe","title":title,"instruction":title,"targetId":"muscles","modelIds":["muscles"]}
        ]});
        let question = json!({"id":"quiz","prompt":title,"explanation":title,"answerId":"a",
            "choices":[{"id":"a","text":title},{"id":"b","text":title}]});
        lesson["steps"][0]["questions"] = json!([question]);
        lesson["steps"][1]["questions"] = json!([question]);
        let (mut files, _) =
            content::lessons::externalize_lesson_tables(&mut lesson, None).unwrap();
        let path = directory.path().join("lesson.json");
        write_file(&path, lesson.to_string().as_bytes()).unwrap();
        for (name, lost_section) in [("scenes.jsonl", "first"), ("questions.jsonl", "second")] {
            let bytes = files.get_mut(name).unwrap();
            let kept = std::str::from_utf8(bytes)
                .unwrap()
                .lines()
                .filter(|line| {
                    serde_json::from_str::<Value>(line).unwrap()["section"] != lost_section
                })
                .collect::<Vec<_>>()
                .join("\n");
            *bytes = kept.into_bytes();
        }
        for (name, bytes) in files {
            write_file(&directory.path().join(name), &bytes).unwrap();
        }
        let first = &lesson["steps"][0]["sceneRef"];
        let second = &lesson["steps"][1]["questionRef"];
        let restored: Value =
            serde_json::from_str(&current_lesson(&path).unwrap().unwrap()).unwrap();
        assert_eq!(&restored["steps"][0]["sceneRef"], first);
        assert_eq!(restored["steps"][0]["instruction"], title);
        assert_eq!(restored["steps"][0]["questions"], json!([question]));
        assert_eq!(restored["steps"][1]["targetId"], "muscles");
        assert!(restored["steps"][1].get("sceneRef").is_none());
        assert_eq!(&restored["steps"][1]["questionRef"], second);
        assert!(lesson::validate(&restored, false).is_ok());
    }

    #[test]
    fn draft_tables_keep_previous_rows_until_metadata_is_committed() {
        let directory = tempfile::tempdir().unwrap();
        let dir = directory.path();
        let path = dir.join("lesson.json");
        let text = json!({"vi":"Kiểm tra","en":""});
        let old = json!({"id":"table-save","version":1,"title":text,"summary":text,"modelId":"",
            "steps":[{"id":"part","kind":"observe","title":text,"instruction":text,
                "targetId":"bones","modelIds":["bones"],"questions":[]}]});
        let mut metadata = old.clone();
        let (tables, retained) =
            content::lessons::externalize_lesson_tables(&mut metadata, None).unwrap();
        stage_lesson_tables(dir, &tables, retained).unwrap();
        write_file(&path, metadata.to_string().as_bytes()).unwrap();
        let read =
            || serde_json::from_str::<Value>(&current_lesson(&path).unwrap().unwrap()).unwrap();
        assert_eq!(read(), old);

        let mut next = old.clone();
        next["steps"][0]["visibleIds"] = json!(["jaw"]);
        next["steps"][0]["questions"] = json!([{"id":"quiz","prompt":text,"explanation":text,
            "answerId":"a","choices":[{"id":"a","text":text},{"id":"b","text":text}]}]);
        let mut metadata = next.clone();
        let (tables, retained) =
            content::lessons::externalize_lesson_tables(&mut metadata, Some(&mut old.clone()))
                .unwrap();
        let retained_paths = retained.keys().cloned().collect();
        stage_lesson_tables(dir, &tables, retained).unwrap();
        assert_eq!(read(), old);
        write_file(&path, metadata.to_string().as_bytes()).unwrap();
        assert_eq!(read(), next);
        compact_lesson_tables(dir, &tables, &retained_paths).unwrap();
        assert_eq!(read(), next);
        assert_eq!(
            read_file(&dir.join("scenes.jsonl"), 4096).unwrap(),
            tables["scenes.jsonl"]
        );
        assert_eq!(
            read_file(&dir.join("questions.jsonl"), 4096).unwrap(),
            tables["questions.jsonl"]
        );
        assert_eq!(fs::read_dir(dir).unwrap().count(), 3);
    }
}

fn retain_lesson_content(dir: &Path, keep: &BTreeSet<String>) -> io::Result<()> {
    let entries = match fs::read_dir(dir.join("content")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let path = format!("content/{}", entry.file_name().to_string_lossy());
        if content::lessons::is_content_path(&path) && !keep.contains(&path) {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn stage_lesson_tables(
    dir: &Path,
    tables: &content::lessons::Files,
    mut retained: content::lessons::Files,
) -> io::Result<()> {
    for name in content::lessons::LESSON_TABLE_FILES {
        let current = tables.get(name).map(Vec::as_slice).unwrap_or_default();
        let bytes = match retained.remove(name) {
            Some(mut previous) => {
                previous.extend_from_slice(current);
                if previous.len() > content::lessons::DRAFT_TABLE_LIMIT {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Lesson table exceeds its size limit",
                    ));
                }
                write_file(&dir.join(name), &previous)?;
                continue;
            }
            None => current,
        };
        if !bytes.is_empty() {
            write_file(&dir.join(name), bytes)?;
        }
    }
    Ok(())
}

fn compact_lesson_tables(
    dir: &Path,
    tables: &content::lessons::Files,
    retained: &BTreeSet<String>,
) -> io::Result<()> {
    for name in content::lessons::LESSON_TABLE_FILES {
        if let Some(bytes) = tables.get(name) {
            if retained.contains(name) {
                write_file(&dir.join(name), bytes)?;
            }
        } else if let Err(error) = fs::remove_file(dir.join(name))
            && error.kind() != io::ErrorKind::NotFound
        {
            return Err(error);
        }
    }
    Ok(())
}

fn image_entries(dir: &Path) -> io::Result<Vec<(String, usize)>> {
    let entries = match fs::read_dir(dir.join("images")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut images = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = format!("images/{}", entry.file_name().to_string_lossy());
        if lesson::image_path(&path) && entry.file_type()?.is_file() {
            images.push((path, entry.metadata()?.len() as usize));
        }
    }
    Ok(images)
}

fn retain_images(dir: &Path, keep: &BTreeSet<String>) -> io::Result<()> {
    for (path, _) in image_entries(dir)? {
        if !keep.contains(&path) {
            fs::remove_file(dir.join(path))?;
        }
    }
    Ok(())
}

fn check_previous(path: &Path, expected: Option<&str>) -> Result<(), String> {
    let current = current_lesson(path).map_err(message)?;
    let parse = |json: &str| serde_json::from_str::<serde_json::Value>(json);
    if current.as_deref().map(parse).transpose().map_err(message)?
        != expected.map(parse).transpose().map_err(message)?
    {
        return Err("The lesson changed since it was opened.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn list_saved_lessons(app: AppHandle) -> Result<Vec<(String, Option<String>)>, String> {
    let (root, _lock) = store(&app)?;
    let mut lessons = Vec::new();
    for entry in fs::read_dir(&root).map_err(message)? {
        let entry = entry.map_err(message)?;
        if !entry.file_type().map_err(message)?.is_dir() {
            continue;
        }
        let path = entry.path();
        match current_lesson(&path.join("lesson.json")) {
            Ok(Some(json)) => {
                let matches = lesson::parse(&json, true)
                    .ok()
                    .and_then(|value| value["id"].as_str().map(|id| directory(&root, id) == path))
                    .unwrap_or(false);
                lessons.push((
                    entry.file_name().to_string_lossy().into_owned(),
                    matches.then_some(json),
                ));
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("Could not read lesson in {}: {error}", path.display());
                lessons.push((entry.file_name().to_string_lossy().into_owned(), None));
            }
        }
    }
    Ok(lessons)
}

#[tauri::command]
pub async fn save_lesson(
    app: AppHandle,
    id: String,
    json: String,
    expected: Option<String>,
) -> Result<(), String> {
    let value = lesson::parse(&json, true).map_err(message)?;
    if value["id"].as_str() != Some(&id) {
        return Err("Lesson ID does not match".into());
    }
    let (root, _lock) = store(&app)?;
    let dir = directory(&root, &id);
    let path = dir.join("lesson.json");
    check_previous(&path, expected.as_deref())?;
    let referenced = lesson::image_paths(&value);
    let images = image_entries(&dir).map_err(message)?;
    let retained: Vec<_> = images
        .iter()
        .filter(|(path, _)| referenced.contains(path))
        .cloned()
        .collect();
    check_image_collection(&retained)?;
    let image_bytes = retained.iter().map(|(_, size)| size).sum::<usize>();
    let paths: HashSet<_> = retained.into_iter().map(|(path, _)| path).collect();
    lesson::validate_resources(&value, &paths)?;
    let mut stored_lesson = value.clone();
    let mut previous = expected
        .as_deref()
        .map(|json| lesson::parse(json, true))
        .transpose()
        .map_err(message)?;
    let (tables, retained) =
        content::lessons::externalize_lesson_tables(&mut stored_lesson, previous.as_mut())?;
    let contents = content::lessons::externalize_lesson_content(&mut stored_lesson)?;
    let resource_bytes = contents
        .values()
        .chain(tables.values())
        .map(Vec::len)
        .sum::<usize>();
    if image_bytes + resource_bytes > catalog::lesson::ARCHIVE_LIMIT - 4 * 1024 * 1024 {
        return Err("Lesson resources exceed 60 MiB".into());
    }
    let stored_json = serde_json::to_vec(&stored_lesson).map_err(message)?;
    if stored_json.len() > JSON_LIMIT {
        return Err("Lesson metadata exceeds 2 MiB".into());
    }
    for (content_path, bytes) in &contents {
        write_file(&dir.join(content_path), bytes).map_err(message)?;
    }
    let retained_paths = retained.keys().cloned().collect();
    stage_lesson_tables(&dir, &tables, retained).map_err(message)?;
    write_file(&path, &stored_json).map_err(message)?;
    if let Err(error) = compact_lesson_tables(&dir, &tables, &retained_paths) {
        eprintln!("Could not compact lesson tables: {error}");
    }
    if let Err(error) = retain_lesson_content(
        &dir,
        &content::lessons::lesson_content_paths(&stored_lesson),
    ) {
        eprintln!("Could not remove unused lesson text: {error}");
    }
    if let Err(error) = retain_images(&dir, &referenced) {
        eprintln!("Could not remove unused lesson images: {error}");
    }
    Ok(())
}

#[tauri::command]
pub async fn export_lesson_file(window: Window, request: Request<'_>) -> Result<(), String> {
    let filename = request
        .headers()
        .get("soma-lesson-filename")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing lesson filename")?;
    let filename = percent_decode_str(filename)
        .decode_utf8()
        .map_err(message)?;
    if filename
        .chars()
        .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
    {
        return Err("Invalid lesson filename".into());
    }
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => Cow::Borrowed(bytes.as_slice()),
        InvokeBody::Json(value) => {
            let values = value.as_array().ok_or("Expected binary lesson archive")?;
            check_file(&filename, values.len())?;
            Cow::Owned(
                values
                    .iter()
                    .map(|value| {
                        value
                            .as_u64()
                            .and_then(|byte| u8::try_from(byte).ok())
                            .ok_or("Invalid lesson archive byte")
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
    };
    check_file(&filename, bytes.len())?;
    let Some(path) = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(filename.into_owned())
        .add_filter("Soma (.lesson.br)", &["br"])
        .blocking_save_file()
    else {
        return Ok(());
    };
    let mut path = path.into_path().map_err(message)?;
    let chosen = path.file_name().ok_or("Missing lesson filename")?;
    let lower = chosen.to_string_lossy().to_ascii_lowercase();
    let has_suffix = lower.ends_with(".lesson.br");
    if !has_suffix {
        let mut name = if lower.ends_with(".br") {
            path.file_stem().unwrap_or(chosen).to_os_string()
        } else {
            chosen.to_os_string()
        };
        name.push(if lower.ends_with(".lesson") {
            ".br"
        } else {
            ".lesson.br"
        });
        path.set_file_name(name);
    }
    write_file_with_overwrite(&path, &bytes, has_suffix).map_err(message)
}

#[tauri::command]
pub async fn retain_lesson_images(
    app: AppHandle,
    id: String,
    keep: Vec<String>,
    expected: Option<String>,
) -> Result<(), String> {
    if keep.iter().any(|path| !lesson::image_path(path)) {
        return Err("Invalid lesson image path".into());
    }
    let (root, _lock) = store(&app)?;
    let dir = directory(&root, &id);
    check_previous(&dir.join("lesson.json"), expected.as_deref()).map_err(message)?;
    let keep = keep.into_iter().collect();
    retain_images(&dir, &keep).map_err(message)
}

#[tauri::command]
pub async fn remove_lesson(app: AppHandle, id: String, expected: String) -> Result<(), String> {
    let (root, _lock) = store(&app)?;
    let dir = directory(&root, &id);
    let path = dir.join("lesson.json");
    check_previous(&path, Some(&expected))?;
    fs::remove_file(path).map_err(message)?;
    if let Err(error) = fs::remove_dir_all(&dir) {
        eprintln!("Lesson image cleanup failed: {error}");
    }
    Ok(())
}

#[tauri::command]
pub async fn list_lesson_images(app: AppHandle, id: String) -> Result<Vec<String>, String> {
    let (root, _lock) = store(&app)?;
    let images = image_entries(&directory(&root, &id)).map_err(message)?;
    Ok(images.into_iter().map(|(path, _)| path).collect())
}

#[tauri::command]
pub async fn get_lesson_image(
    app: AppHandle,
    id: String,
    path: String,
) -> Result<Response, String> {
    if !lesson::image_path(&path) {
        return Err("Invalid lesson image path".into());
    }
    let (root, _lock) = store(&app)?;
    match read_file(&directory(&root, &id).join(path), IMAGE_LIMIT) {
        Ok(bytes) => Ok(Response::new(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Response::new(Vec::new())),
        Err(error) => Err(message(error)),
    }
}

#[tauri::command]
pub async fn put_lesson_image(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let header = |name| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    let id = header("soma-lesson-id").ok_or("Missing lesson ID")?;
    let path = header("soma-image-path").ok_or("Missing lesson image path")?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => Cow::Borrowed(bytes.as_slice()),
        InvokeBody::Json(value) => {
            let values = value.as_array().ok_or("Expected binary lesson image")?;
            content::lessons::check_image_size(values.len())?;
            Cow::Owned(
                values
                    .iter()
                    .map(|value| {
                        value
                            .as_u64()
                            .and_then(|byte| u8::try_from(byte).ok())
                            .ok_or("Invalid lesson image byte")
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
    };
    if image_info(&bytes)?.path != path {
        return Err("Lesson image does not match its path".into());
    }
    let (root, _lock) = store(&app)?;
    write_file(&directory(&root, id).join(path), &bytes).map_err(message)
}
