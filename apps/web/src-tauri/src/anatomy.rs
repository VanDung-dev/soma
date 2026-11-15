use crate::storage::{read_file, write_file};
use std::{collections::HashSet, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const LIMIT: usize = 2 * 1024 * 1024;
const ID_LIMIT: usize = 1024;
const COUNT_LIMIT: usize = 100_000;

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("anatomy");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root.join("visibility.json"))
}

fn valid(ids: &[String]) -> bool {
    ids.len() <= COUNT_LIMIT
        && ids.iter().all(|id| !id.is_empty() && id.len() <= ID_LIMIT)
        && ids.iter().collect::<HashSet<_>>().len() == ids.len()
}

#[tauri::command]
pub async fn load_anatomy_hidden_ids(app: AppHandle) -> Result<Option<Vec<String>>, String> {
    let path = path(&app)?;
    let bytes = match read_file(&path, LIMIT) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let ids: Vec<String> = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if !valid(&ids) {
        return Err("Invalid Anatomy visibility data".into());
    }
    Ok(Some(ids))
}

#[tauri::command]
pub async fn save_anatomy_hidden_ids(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    if !valid(&ids) {
        return Err("Invalid Anatomy visibility data".into());
    }
    let bytes = serde_json::to_vec(&ids).map_err(|error| error.to_string())?;
    if bytes.len() > LIMIT {
        return Err("Anatomy visibility data exceeds the size limit".into());
    }
    write_file(&path(&app)?, &bytes).map_err(|error| error.to_string())
}
