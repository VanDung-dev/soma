use crate::storage::{read_file, write_file};
use serde_json::{Map, Value};
use std::{
    fs::{self, File},
    io,
    path::Path,
};
use tauri::{AppHandle, Manager};

type Settings = Map<String, Value>;
const LIMIT: usize = 64 * 1024;

fn font_pt(value: &Value) -> Option<u16> {
    value
        .as_str()?
        .parse::<u16>()
        .ok()
        .filter(|size| (6..=18).contains(size))
}

fn valid(name: &str, value: &Value) -> bool {
    match name {
        "language" => matches!(value.as_str(), Some("vi" | "en")),
        "theme" => matches!(value.as_str(), Some("auto" | "light" | "dark")),
        "fontSize" => font_pt(value).is_some(),
        "graphics" | "shortcuts" => value.is_object(),
        "camera" => value.as_str().is_some_and(|id| id.len() <= 1024),
        _ => false,
    }
}

fn update_settings(root: &Path, incoming: Settings, replace: bool) -> io::Result<Settings> {
    fs::create_dir_all(root)?;
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(".settings.lock"))?;
    lock.lock()?;

    let path = root.join("settings.json");
    let (mut settings, mut changed) = match read_file(&path, LIMIT) {
        Ok(bytes) => (serde_json::from_slice::<Settings>(&bytes)?, false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (Settings::new(), true),
        Err(error) => return Err(error),
    };
    for (name, value) in incoming {
        if valid(&name, &value) && (replace || !settings.contains_key(&name)) {
            changed |= settings.get(&name) != Some(&value);
            settings.insert(name, value);
        }
    }
    if changed {
        let bytes = serde_json::to_vec_pretty(&settings)?;
        if bytes.len() > LIMIT {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Settings exceed the size limit",
            ));
        }
        write_file(&path, &bytes)?;
    }
    Ok(settings)
}

#[tauri::command]
pub async fn load_settings(app: AppHandle, legacy: Settings) -> Result<Settings, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let settings = update_settings(&root, legacy, false).map_err(|error| error.to_string())?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    crate::window_minimum::set_font_size(
        &app,
        settings.get("fontSize").and_then(font_pt).unwrap_or(10),
    );
    Ok(settings)
}

#[tauri::command]
pub async fn save_setting(app: AppHandle, name: String, value: Value) -> Result<(), String> {
    if !valid(&name, &value) {
        return Err("Invalid application setting".into());
    }
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let size = (name == "fontSize").then(|| font_pt(&value)).flatten();
    update_settings(&root, Settings::from_iter([(name, value)]), true)
        .map_err(|error| error.to_string())?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    if let Some(size) = size {
        crate::window_minimum::set_font_size(&app, size);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_migrate_once_and_update_independently() -> io::Result<()> {
        let dir = tempfile::tempdir()?;
        let legacy = Settings::from_iter([
            ("theme".into(), json!("dark")),
            ("language".into(), json!("en")),
        ]);
        update_settings(dir.path(), legacy.clone(), false)?;
        update_settings(
            dir.path(),
            Settings::from_iter([("theme".into(), json!("light"))]),
            true,
        )?;
        let reopened = update_settings(dir.path(), legacy, false)?;
        assert_eq!(reopened["theme"], "light");
        assert_eq!(reopened["language"], "en");
        assert!(dir.path().join("settings.json").is_file());
        Ok(())
    }
}
