#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{LogicalSize, Manager, PhysicalSize, WebviewWindow, WindowEvent};

#[tauri::command]
fn get_catalog() -> Result<String, String> {
    catalog::catalog_json().map_err(|error| error.to_string())
}

fn interface_zoom(
    work_area: PhysicalSize<u32>,
    scale_factor: f64,
    reference: LogicalSize<f64>,
) -> Option<f64> {
    if work_area.width == 0 || work_area.height == 0 {
        return None;
    }
    let available = work_area.to_logical::<f64>(scale_factor);
    Some(
        (available.width / reference.width)
            .min(available.height / reference.height)
            .clamp(0.8, 1.0),
    )
}

fn fit_interface(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Some(config) = window
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
    else {
        return;
    };
    let reference = LogicalSize::new(config.width, config.height);
    let Some(zoom) = interface_zoom(monitor.work_area().size, monitor.scale_factor(), reference)
    else {
        return;
    };
    let applied = window.state::<AtomicU64>();
    if applied.load(Ordering::Relaxed) != zoom.to_bits() {
        match window.set_zoom(zoom) {
            Ok(()) => applied.store(zoom.to_bits(), Ordering::Relaxed),
            Err(error) => eprintln!("Could not scale the Soma interface: {error}"),
        }
    }
}

fn main() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_catalog])
        .manage(AtomicU64::new(1.0_f64.to_bits()))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                fit_interface(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(
                    event,
                    WindowEvent::Moved(_)
                        | WindowEvent::ScaleFactorChanged { .. }
                        | WindowEvent::Focused(true)
                )
                && let Some(webview) = window.get_webview_window(window.label())
            {
                fit_interface(&webview);
            }
        })
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interface_fits_monitor_work_area_at_each_display_scale() {
        let reference = LogicalSize::new(1280.0, 800.0);
        let zoom = |width, height, scale| {
            interface_zoom(PhysicalSize::new(width, height), scale, reference)
        };
        for (width, height, scale_factor) in [
            (1280, 680, 1.0),
            (1600, 850, 1.25),
            (1920, 1020, 1.5),
            (2560, 1360, 2.0),
        ] {
            assert_eq!(zoom(width, height, scale_factor), Some(0.85));
        }
        assert_eq!(zoom(1152, 800, 1.0), Some(0.9));
        assert_eq!(zoom(800, 520, 1.0), Some(0.8));
        assert_eq!(zoom(2880, 1800, 2.0), Some(1.0));
        assert_eq!(zoom(0, 0, 1.0), None);
    }
}
