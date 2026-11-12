use crate::storage::{read_file, write_file};
use catalog::lesson::{self, IMAGE_LIMIT, JSON_LIMIT};
use content::lessons::{check_image_collection, image_info};
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    collections::{BTreeSet, HashSet},
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};
use tauri::{
    AppHandle, Manager,
    ipc::{InvokeBody, Request, Response},
};

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
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
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
    let paths: HashSet<_> = retained.into_iter().map(|(path, _)| path).collect();
    lesson::validate_resources(&value, &paths)?;
    write_file(&path, json.as_bytes()).map_err(message)?;
    if let Err(error) = retain_images(&dir, &referenced) {
        eprintln!("Could not remove unused lesson images: {error}");
    }
    Ok(())
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
