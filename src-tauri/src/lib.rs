pub mod agent;
mod commands;
pub mod document;
pub mod error;
pub mod platform;
pub mod provider;
pub mod security;
pub mod storage;
pub mod suggestion;
pub mod window_chrome;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let state = AppState::initialize(&data_dir)?;
            app.manage(state);

            // Windows 11 Snap Layouts needs the native hit test to see the
            // app-drawn maximize button; macOS keeps its own traffic lights.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                window_chrome::install(&window)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::open_document,
            commands::create_document,
            commands::convert_document_encoding,
            commands::save_document,
            commands::save_document_as,
            commands::check_external_change,
            commands::reload_document,
            commands::close_document,
            commands::scan_folder,
            commands::open_project,
            commands::list_projects,
            commands::list_recent_documents,
            commands::get_settings,
            commands::set_settings,
            commands::get_provider_config,
            commands::save_provider_config,
            commands::test_provider,
            commands::prepare_suggestion,
            commands::execute_suggestion,
            commands::cancel_request,
            commands::reject_suggestion,
            commands::mark_suggestion_stale,
            commands::apply_suggestion,
            commands::list_suggestions,
            commands::prepare_chat,
            commands::execute_chat,
            commands::list_messages,
            commands::list_conversations,
            commands::get_conversation,
            commands::create_snapshot,
            commands::list_snapshots,
            commands::read_snapshot,
            commands::restore_snapshot,
            commands::get_style_profile,
            commands::save_style_profile,
            commands::report_client_event,
            commands::set_caption_button_rect,
            commands::debug_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vesrio");
}
