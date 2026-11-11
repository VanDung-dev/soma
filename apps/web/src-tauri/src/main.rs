#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lessons;
mod settings;
mod storage;

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, LogicalSize, Manager, PhysicalSize, WebviewWindow, WindowEvent};
#[cfg(target_os = "macos")]
use tauri::{
    Wry,
    menu::{AboutMetadata, Menu, MenuItemKind, PredefinedMenuItem},
};

#[tauri::command]
fn get_catalog() -> Result<String, String> {
    catalog::catalog_json().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_attribution(app: AppHandle, path: &str) -> Result<(), String> {
    let resource = match path {
        "/home/ATTRIBUTION.md" => "home/ATTRIBUTION.md",
        "/models/z-anatomy/ATTRIBUTION.md" => "models/z-anatomy/ATTRIBUTION.md",
        _ => return Err("Unknown attribution document".into()),
    };
    let path = app
        .path()
        .resolve(resource, tauri::path::BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    if !path.is_file() {
        return Err("Attribution document is missing".into());
    }
    let editor = match std::env::consts::OS {
        "macos" => "/System/Applications/TextEdit.app",
        "windows" => "notepad.exe",
        _ => return Err("No configured text editor".into()),
    };
    tauri_plugin_opener::open_path(path, Some(editor)).map_err(|error| error.to_string())
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

#[cfg(target_os = "macos")]
fn traffic_light_position(window: &WebviewWindow) -> Option<(f64, f64)> {
    window
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
        .and_then(|config| config.traffic_light_position.as_ref())
        .map(|position| (position.x, position.y))
}

#[cfg(target_os = "macos")]
fn keep_traffic_lights_aligned(window: &WebviewWindow) {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSView, NSWindow, NSWindowButton, NSWindowStyleMask};
    use objc2_foundation::NSTimer;

    let Some((x, y)) = traffic_light_position(window) else {
        return;
    };
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    let restore = RcBlock::new(move |timer: NonNull<NSTimer>| {
        let Some(window) = app.get_webview_window(&label) else {
            unsafe { timer.as_ref() }.invalidate();
            return;
        };
        let Ok(native) = window.ns_window() else {
            return;
        };
        let Some(native) = (unsafe { native.cast::<NSWindow>().as_ref() }) else {
            return;
        };
        if !native.isVisible() || native.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return;
        }
        let [Some(close), Some(minimize), Some(zoom)] = [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ]
        .map(|button| native.standardWindowButton(button)) else {
            return;
        };
        if [&close, &minimize, &zoom]
            .iter()
            .any(|button| button.isHiddenOrHasHiddenAncestor() || button.alphaValue() < 1.0)
        {
            return;
        }
        let Some(titlebar) = (unsafe { close.superview().and_then(|view| view.superview()) })
        else {
            return;
        };
        let button = NSView::frame(&close);
        let height = NSView::frame(&titlebar).size.height;
        if ((button.origin.x - x).abs() > 0.5 || (height - button.size.height - y).abs() > 0.5)
            && let Ok(title) = window.title()
        {
            let _ = window.set_title(&title);
        }
    });
    let timer =
        unsafe { NSTimer::scheduledTimerWithTimeInterval_repeats_block(0.25, true, &restore) };
    timer.setTolerance(0.05);
}

#[cfg(target_os = "macos")]
fn macos_menu(app: &AppHandle<Wry>) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(soma_menu)) = menu.items()?.first() {
        let bundle = &app.config().bundle;
        let platform = match std::env::consts::ARCH {
            "aarch64" => "Apple Silicon · arm64",
            "x86_64" => "Intel · x86_64",
            arch => arch,
        };
        let about = PredefinedMenuItem::about(
            app,
            None,
            Some(AboutMetadata {
                name: Some(app.package_info().name.clone()),
                version: Some(app.package_info().version.to_string()),
                short_version: Some(format!("macOS · {platform}")),
                copyright: bundle.copyright.clone(),
                ..Default::default()
            }),
        )?;
        soma_menu.remove_at(0)?;
        soma_menu.insert(&about, 0)?;
    }
    Ok(menu)
}

fn main() -> Result<(), tauri::Error> {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(macos_menu);

    builder
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            settings::load_settings,
            settings::save_setting,
            get_catalog,
            open_attribution,
            lessons::list_saved_lessons,
            lessons::save_lesson,
            lessons::remove_lesson,
            lessons::list_lesson_images,
            lessons::get_lesson_image,
            lessons::put_lesson_image,
        ])
        .manage(AtomicU64::new(1.0_f64.to_bits()))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                fit_interface(&window);
                #[cfg(target_os = "macos")]
                keep_traffic_lights_aligned(&window);
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
