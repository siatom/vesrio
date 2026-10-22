//! Native caption-button integration for the app-drawn title bar.
//!
//! Windows 11 only offers the Snap Layouts flyout when `WM_NCHITTEST` reports
//! `HTMAXBUTTON` under the cursor. The caption buttons are HTML, so the shell
//! sees them as ordinary client pixels and never shows the flyout. We subclass
//! the window procedure and answer `HTMAXBUTTON` for the rectangle the frontend
//! reports, then forward hover and click back to the webview so
//! `toggleMaximize` stays the only owner of the window state change.
//!
//! macOS uses the native traffic lights instead (see `tauri.macos.conf.json`),
//! so nothing here applies there.

use serde::Deserialize;

/// Caption button rectangle in CSS pixels, relative to the client area.
///
/// The frontend reports CSS pixels; the hit test scales them with the live
/// window DPI so the same rectangle stays correct when the window moves to a
/// monitor with a different scale factor.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct CaptionRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Emitted when the native hit test reports a click on the maximize button.
pub const EVENT_MAXIMIZE_CLICK: &str = "caption:maximize-click";
/// Emitted when the pointer enters or leaves the maximize button.
pub const EVENT_HOVER: &str = "caption:hover";

/// Whether a client-area point falls inside the caption button.
///
/// `scale` is `dpi / 96.0`; the rectangle arrives in CSS pixels.
fn contains(rect: CaptionRect, scale: f64, x: f64, y: f64) -> bool {
    let left = rect.x * scale;
    let top = rect.y * scale;
    x >= left && x < left + rect.width * scale && y >= top && y < top + rect.height * scale
}

#[cfg(windows)]
mod windows_impl {
    use super::{contains, CaptionRect, EVENT_HOVER, EVENT_MAXIMIZE_CLICK};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, OnceLock};
    use tauri::{Emitter, Manager, WebviewWindow};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::ScreenToClient;
    use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT,
    };
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        HTMAXBUTTON, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE,
        WM_NCMOUSEMOVE,
    };

    /// Arbitrary but stable id; the app only ever subclasses one window.
    const SUBCLASS_ID: usize = 0x5645_5352; // "VESR"

    static RECT: Mutex<Option<CaptionRect>> = Mutex::new(None);
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static HOVERED: AtomicBool = AtomicBool::new(false);

    pub fn set_maximize_button_rect(rect: Option<CaptionRect>) {
        if let Ok(mut slot) = RECT.lock() {
            *slot = rect;
        }
    }

    pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
        let _ = APP.set(window.app_handle().clone());
        let hwnd = window.hwnd()?.0 as HWND;
        unsafe {
            SetWindowSubclass(hwnd, Some(caption_proc), SUBCLASS_ID, 0);
        }
        Ok(())
    }

    fn emit<S: serde::Serialize + Clone>(event: &str, payload: S) {
        if let Some(app) = APP.get() {
            let _ = app.emit(event, payload);
        }
    }

    fn set_hovered(hovered: bool) {
        if HOVERED.swap(hovered, Ordering::Relaxed) != hovered {
            emit(EVENT_HOVER, hovered);
        }
    }

    /// `WM_NCHITTEST` / `WM_NCLBUTTONDOWN` pack signed 16-bit screen coordinates.
    fn signed_low(value: LPARAM) -> i32 {
        (value & 0xffff) as u16 as i16 as i32
    }

    fn signed_high(value: LPARAM) -> i32 {
        ((value >> 16) & 0xffff) as u16 as i16 as i32
    }

    fn dpi_scale(hwnd: HWND) -> f64 {
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        if dpi == 0 {
            1.0
        } else {
            dpi as f64 / 96.0
        }
    }

    /// Point inside the caption button, in client (physical) pixels.
    fn over_button(hwnd: HWND, rect: CaptionRect, x: i32, y: i32) -> bool {
        contains(rect, dpi_scale(hwnd), x as f64, y as f64)
    }

    unsafe fn track_non_client_leave(hwnd: HWND) {
        let mut track = TRACKMOUSEEVENT {
            cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE | TME_NONCLIENT,
            hwndTrack: hwnd,
            dwHoverTime: 0,
        };
        TrackMouseEvent(&mut track);
    }

    unsafe extern "system" fn caption_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        match msg {
            WM_NCHITTEST => {
                if let Ok(slot) = RECT.lock() {
                    if let Some(rect) = *slot {
                        // Screen coordinates in, client coordinates out.
                        let mut point = POINT {
                            x: signed_low(lparam),
                            y: signed_high(lparam),
                        };
                        if ScreenToClient(hwnd, &mut point) != 0
                            && over_button(hwnd, rect, point.x, point.y)
                        {
                            return HTMAXBUTTON as LRESULT;
                        }
                    }
                }
            }
            WM_NCMOUSEMOVE => {
                // The button is non-client now, so the webview stops receiving
                // mouse messages there; keep its hover state in sync ourselves.
                track_non_client_leave(hwnd);
                let over = match RECT.lock() {
                    Ok(slot) => slot
                        .map(|rect| {
                            over_button(hwnd, rect, signed_low(lparam), signed_high(lparam))
                        })
                        .unwrap_or(false),
                    Err(_) => false,
                };
                set_hovered(over);
            }
            WM_NCMOUSELEAVE => set_hovered(false),
            // Swallow both edges: DefWindowProc would otherwise act on
            // HTMAXBUTTON itself and toggle the window twice.
            WM_NCLBUTTONDOWN | WM_NCLBUTTONUP if wparam as u32 == HTMAXBUTTON => {
                if msg == WM_NCLBUTTONDOWN {
                    set_hovered(false);
                    emit(EVENT_MAXIMIZE_CLICK, ());
                }
                return 0;
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}

#[cfg(windows)]
pub use windows_impl::{install, set_maximize_button_rect};

#[cfg(not(windows))]
pub fn install(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn set_maximize_button_rect(_rect: Option<CaptionRect>) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect() -> CaptionRect {
        CaptionRect {
            x: 100.0,
            y: 0.0,
            width: 44.0,
            height: 46.0,
        }
    }

    #[test]
    fn hit_test_respects_the_reported_rectangle() {
        let r = rect();
        assert!(contains(r, 1.0, 100.0, 0.0));
        assert!(contains(r, 1.0, 143.9, 45.9));
        assert!(!contains(r, 1.0, 99.9, 10.0));
        assert!(!contains(r, 1.0, 144.0, 10.0));
        assert!(!contains(r, 1.0, 120.0, 46.0));
    }

    #[test]
    fn hit_test_scales_with_dpi() {
        let r = rect();
        // At 150% the CSS rectangle covers 150..216 physical pixels.
        assert!(!contains(r, 1.5, 149.0, 10.0));
        assert!(contains(r, 1.5, 150.0, 10.0));
        assert!(contains(r, 1.5, 215.0, 68.0));
        assert!(!contains(r, 1.5, 216.0, 10.0));
    }
}
