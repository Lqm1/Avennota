#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 選択フォルダをfsスコープへ追加するのはdialogプラグイン。persisted-scopeは再起動後の復元のために、そのスコープを保存する。
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![
            desktop_tools::open_folder_manager,
            desktop_tools::open_parent_folder,
            desktop_tools::configure_window,
            desktop_tools::write_document
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                for path in paths {
                    let folder = if path.is_dir() {
                        path.as_path()
                    } else {
                        path.parent().unwrap_or(path.as_path())
                    };
                    let _ = window
                        .app_handle()
                        .fs_scope()
                        .allow_directory(folder, false);
                    if path.is_file() {
                        let _ = window.app_handle().fs_scope().allow_file(path);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
mod desktop_tools;
use tauri::Manager;
use tauri_plugin_fs::FsExt;
