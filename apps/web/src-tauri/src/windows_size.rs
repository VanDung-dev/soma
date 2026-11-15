#[cfg(target_os = "windows")]
use std::sync::{Arc, Mutex};

use tauri::PhysicalSize;
#[cfg(target_os = "windows")]
use tauri::{Manager, WebviewWindow, WindowEvent};

fn fit_size(size: PhysicalSize<u32>, work_area: Option<PhysicalSize<u32>>) -> PhysicalSize<u32> {
    work_area.map_or(size, |area| {
        PhysicalSize::new(size.width.min(area.width), size.height.min(area.height))
    })
}

struct WindowSize {
    normal: PhysicalSize<u32>,
    pending_scale: Option<f64>,
}

impl WindowSize {
    fn resized(&mut self, size: PhysicalSize<u32>) {
        if self.pending_scale.is_none() && size.width > 0 && size.height > 0 {
            self.normal = size;
        }
    }

    fn finish_dpi_change(
        &mut self,
        scale: f64,
        work_area: Option<PhysicalSize<u32>>,
    ) -> Option<PhysicalSize<u32>> {
        if self.pending_scale != Some(scale) {
            return None;
        }
        self.pending_scale = None;
        self.normal = fit_size(self.normal, work_area);
        Some(self.normal)
    }
}

#[cfg(target_os = "windows")]
fn is_normal(window: &WebviewWindow) -> bool {
    window.is_maximized().ok() == Some(false)
        && window.is_fullscreen().ok() == Some(false)
        && window.is_minimized().ok() == Some(false)
}

#[cfg(target_os = "windows")]
pub fn configure(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(config) = window
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
    else {
        return Ok(());
    };
    let work_area = window
        .current_monitor()?
        .map(|monitor| monitor.work_area().size);
    let initial = PhysicalSize::new(config.width.round() as u32, config.height.round() as u32);
    let minimum = PhysicalSize::new(
        config.min_width.unwrap_or_default().round() as u32,
        config.min_height.unwrap_or_default().round() as u32,
    );
    window.set_min_size(Some(fit_size(minimum, work_area)))?;
    window.set_size(fit_size(initial, work_area))?;

    let size = Arc::new(Mutex::new(WindowSize {
        normal: window.inner_size()?,
        pending_scale: None,
    }));
    let window = window.clone();
    window.clone().on_window_event(move |event| {
        if !is_normal(&window) {
            return;
        }
        match *event {
            WindowEvent::Resized(physical) => size.lock().unwrap().resized(physical),
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                size.lock().unwrap().pending_scale = Some(scale_factor);
                let window = window.clone();
                let size = size.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = window.clone().run_on_main_thread(move || {
                        if window.scale_factor().ok() != Some(scale_factor) {
                            return;
                        }
                        let work_area = window
                            .current_monitor()
                            .ok()
                            .flatten()
                            .map(|monitor| monitor.work_area().size);
                        let desired = size
                            .lock()
                            .unwrap()
                            .finish_dpi_change(scale_factor, work_area);
                        let minimum = crate::window_minimum::refresh(&window).ok().flatten();
                        let desired = desired.map(|size| {
                            minimum.map_or(size, |minimum| {
                                PhysicalSize::new(
                                    size.width.max(minimum.width),
                                    size.height.max(minimum.height),
                                )
                            })
                        });
                        if let Some(desired) = desired
                            && is_normal(&window)
                            && window.inner_size().ok() != Some(desired)
                            && let Err(error) = window.set_size(desired)
                        {
                            eprintln!(
                                "Could not resize the Soma window after a DPI change: {error}"
                            );
                        }
                    });
                });
            }
            _ => {}
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_size_preserves_physical_pixels_across_common_dpi_changes() {
        let original = PhysicalSize::new(1280, 800);
        let mut size = WindowSize {
            normal: original,
            pending_scale: None,
        };
        for scale in [1.25, 1.5, 1.75, 2.0, 1.0] {
            size.pending_scale = Some(scale);
            size.resized(PhysicalSize::new(1920, 1200));
            assert_eq!(size.finish_dpi_change(scale, None), Some(original));
        }
        let resized = PhysicalSize::new(1150, 780);
        size.resized(resized);
        size.pending_scale = Some(1.5);
        assert_eq!(size.finish_dpi_change(1.25, None), None);
        assert_eq!(
            size.finish_dpi_change(1.5, Some(PhysicalSize::new(1200, 728))),
            Some(PhysicalSize::new(1150, 728))
        );
    }
}
