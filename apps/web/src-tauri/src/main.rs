#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod anatomy;
mod lessons;
mod settings;
mod storage;
mod wikipedia;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod window_minimum;
#[cfg(any(target_os = "windows", test))]
mod windows_size;

use tauri::{AppHandle, Manager};
#[cfg(target_os = "macos")]
use tauri::{
    WebviewWindow, Wry,
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
        "/icons/ATTRIBUTION.md" => "icons/ATTRIBUTION.md",
        "/hand-input/ATTRIBUTION.md" => "hand-input/ATTRIBUTION.md",
        "/models/z-anatomy/ATTRIBUTION.md" => "models/z-anatomy/ATTRIBUTION.md",
        "/licenses/LICENSE.txt" => "licenses/LICENSE.txt",
        "/licenses/NOTICE.txt" => "licenses/NOTICE.txt",
        "/licenses/brotli.txt" => "licenses/brotli.txt",
        "/licenses/lesson-content.txt" => "licenses/lesson-content.txt",
        "/licenses/squoosh.txt" => "licenses/squoosh.txt",
        "/licenses/tinymce.md" => "licenses/tinymce.md",
        "/licenses/dompurify.txt" => "licenses/dompurify.txt",
        _ => return Err("Unknown source document".into()),
    };
    let path = app
        .path()
        .resolve(resource, tauri::path::BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    if !path.is_file() {
        return Err("Source document is missing".into());
    }
    let editor = match std::env::consts::OS {
        "macos" => "/System/Applications/TextEdit.app",
        "windows" => "notepad.exe",
        _ => return Err("No configured text editor".into()),
    };
    tauri_plugin_opener::open_path(path, Some(editor)).map_err(|error| error.to_string())
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            anatomy::load_anatomy_hidden_ids,
            anatomy::save_anatomy_hidden_ids,
            settings::load_settings,
            settings::save_setting,
            get_catalog,
            open_attribution,
            wikipedia::wikipedia_proxy_url,
            lessons::list_saved_lessons,
            lessons::save_lesson,
            lessons::export_lesson_file,
            lessons::retain_lesson_images,
            lessons::remove_lesson,
            lessons::list_lesson_images,
            lessons::get_lesson_image,
            lessons::put_lesson_image,
        ])
        .setup(|app| {
            app.manage(wikipedia::Proxy::start());
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            if let Some(window) = app.get_webview_window("main") {
                window_minimum::configure(&window);
                #[cfg(target_os = "windows")]
                {
                    if let Err(error) = windows_size::configure(&window) {
                        eprintln!("Could not size the Soma window: {error}");
                    }
                    window.show()?;
                }
                #[cfg(target_os = "macos")]
                keep_traffic_lights_aligned(&window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
}
