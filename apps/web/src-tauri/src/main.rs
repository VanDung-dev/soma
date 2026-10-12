#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn get_catalog() -> Result<String, String> {
    anatomy_core::catalog_json().map_err(|error| error.to_string())
}

fn main() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_catalog])
        .run(tauri::generate_context!())
}
