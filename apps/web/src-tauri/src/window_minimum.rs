use std::sync::Mutex;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalSize, Size, WebviewWindow, WindowEvent};

struct WindowMinimum {
    reference: LogicalSize<f64>,
    floor: LogicalSize<f64>,
    font_pt: Option<u16>,
    applied: Option<Size>,
}

fn minimum(
    reference: LogicalSize<f64>,
    floor: LogicalSize<f64>,
    font_pt: u16,
    available: Option<LogicalSize<f64>>,
) -> LogicalSize<f64> {
    let zoom = f64::from(font_pt.min(10)) / 10.0;
    let preferred = LogicalSize::new(
        (reference.width * zoom).ceil().max(floor.width),
        (reference.height * zoom).ceil().max(floor.height),
    );
    match available {
        Some(area) if preferred.width <= area.width && preferred.height <= area.height => preferred,
        Some(area) => LogicalSize::new(floor.width.min(area.width), floor.height.min(area.height)),
        None => floor,
    }
}

pub fn refresh(window: &WebviewWindow) -> tauri::Result<Option<PhysicalSize<u32>>> {
    let Some(state) = window.try_state::<Mutex<WindowMinimum>>() else {
        return Ok(None);
    };
    if window.is_maximized()? || window.is_fullscreen()? || window.is_minimized()? {
        return Ok(None);
    }
    let (reference, floor, font_pt) = {
        let state = state.lock().unwrap();
        (state.reference, state.floor, state.font_pt)
    };
    let Some(font_pt) = font_pt else {
        return Ok(None);
    };
    let scale = window.scale_factor()?;
    let available = if let Some(monitor) = window.current_monitor()? {
        #[cfg(target_os = "windows")]
        if monitor.scale_factor() != scale {
            return Ok(None);
        }
        let work_area = monitor.work_area().size;
        let inner = window.inner_size()?;
        let outer = window.outer_size()?;
        Some(
            PhysicalSize::new(
                work_area
                    .width
                    .saturating_sub(outer.width.saturating_sub(inner.width)),
                work_area
                    .height
                    .saturating_sub(outer.height.saturating_sub(inner.height)),
            )
            .to_logical(monitor.scale_factor()),
        )
    } else {
        None
    };
    let logical = minimum(reference, floor, font_pt, available);
    let physical = logical.to_physical::<u32>(scale);
    #[cfg(target_os = "macos")]
    let constraint = Size::Logical(logical);
    #[cfg(target_os = "windows")]
    let constraint = Size::Physical(physical);
    {
        let mut state = state.lock().unwrap();
        if state.applied == Some(constraint) {
            return Ok(Some(physical));
        }
        state.applied = Some(constraint);
    }
    if let Err(error) = window.set_min_size(Some(constraint)) {
        state.lock().unwrap().applied = None;
        return Err(error);
    }
    Ok(Some(physical))
}

fn refresh_or_log(window: &WebviewWindow) {
    if let Err(error) = refresh(window) {
        eprintln!("Could not update the Soma window minimum: {error}");
    }
}

pub fn configure(window: &WebviewWindow) {
    let Some(config) = window
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
    else {
        return;
    };
    window.manage(Mutex::new(WindowMinimum {
        reference: LogicalSize::new(config.width, config.height),
        floor: LogicalSize::new(
            config.min_width.unwrap_or_default(),
            config.min_height.unwrap_or_default(),
        ),
        font_pt: None,
        applied: None,
    }));
    let window = window.clone();
    window.clone().on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::Focused(true)
                | WindowEvent::ScaleFactorChanged { .. }
        ) {
            let window = window.clone();
            let _ = window
                .clone()
                .run_on_main_thread(move || refresh_or_log(&window));
        }
    });
}

pub fn set_font_size(app: &AppHandle, font_pt: u16) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = app.run_on_main_thread(move || {
        if let Some(state) = window.try_state::<Mutex<WindowMinimum>>() {
            state.lock().unwrap().font_pt = Some(font_pt);
            refresh_or_log(&window);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimum_scales_with_text_and_falls_back_on_smaller_monitors() {
        let base = LogicalSize::new(1280.0, 800.0);
        let floor = LogicalSize::new(800.0, 500.0);
        let large = Some(LogicalSize::new(1536.0, 824.0));
        assert_eq!(minimum(base, floor, 6, large), floor);
        assert_eq!(
            minimum(base, floor, 8, large),
            LogicalSize::new(1024.0, 640.0)
        );
        assert_eq!(minimum(base, floor, 10, large), base);
        assert_eq!(minimum(base, floor, 18, large), base);
        let small = Some(LogicalSize::new(1280.0, 680.0));
        assert_eq!(minimum(base, floor, 10, small), floor);
        let windows_floor = LogicalSize::new(800.0, 520.0);
        assert_eq!(minimum(base, windows_floor, 6, large), windows_floor);
        let narrow = LogicalSize::new(720.0, 480.0);
        assert_eq!(minimum(base, windows_floor, 10, Some(narrow)), narrow);
    }
}
